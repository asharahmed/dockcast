/**
 * Builds the public status snapshot (`docs/api.md` GET /status). This is the only place that turns
 * database rows into the response, and the response type is the strict allowlist schema.
 */
import type { Pool } from '@dockcast/db';
import type { StatusDayCell, StatusModelUpdate, StatusResponse, StatusState } from '@dockcast/shared';
import {
  getFreshness,
  getLastTrainSuccess,
  getLatestTrainRow,
  getReferenceTrainRun,
  getSampleStats,
  getTrainRuns,
  dailyKey,
  STATUS_COMPONENTS,
  type FinishedTrainRow,
  type StatusComponent,
} from '../services/status.queries.js';
import { buildReference, buildRunning, RUNNING_MAX_AGE_S, type Running } from './compute.js';
import {
  ageS,
  coarseAgo,
  dayCell,
  forecastsState,
  lastDays,
  modelsState,
  stationsState,
  uptimePct,
  utcDate,
} from './health.js';
import type { LatencyTracker } from './latency.js';

const DAY_MS = 86_400_000;
const HISTORY_DAYS = 14;

export interface SnapshotDeps {
  pool: Pool;
  now: () => Date;
  deployedAt: Date;
  latency: LatencyTracker;
}

/** Component states derived from freshness; shared with the sampler so both agree. */
export function componentStates(
  fresh: { collector_ok_at: Date | null; predict_at: Date | null; predict_ok: boolean | null },
  now: Date,
): { stations: StatusState; forecasts: StatusState; stationsAgeS: number | null; forecastsAgeS: number | null } {
  const stationsAgeS = ageS(fresh.collector_ok_at, now);
  const forecastsAgeS = ageS(fresh.predict_at, now);
  return {
    stations: stationsState(stationsAgeS),
    forecasts: forecastsState(forecastsAgeS, fresh.predict_ok),
    stationsAgeS,
    forecastsAgeS,
  };
}

const wholeMin = (s: number | null): number | null => (s === null ? null : Math.floor(s / 60));

/** One row per UTC date, newest first: a day is a success if any run succeeded that day. */
export function modelUpdateRows(runs: FinishedTrainRow[]): StatusModelUpdate[] {
  const byDay = new Map<string, StatusModelUpdate>();
  for (const r of runs) {
    // Unfinished rows are crashed attempts (a retry is a separate row); they are not shown.
    if (!r.finished_at || r.ok === null) continue;
    const date = utcDate(r.started_at);
    const row: StatusModelUpdate = {
      date,
      ok: r.ok,
      duration_min: Math.round((r.finished_at.getTime() - r.started_at.getTime()) / 60_000),
    };
    const prev = byDay.get(date);
    // Newest first: keep the first success seen, else the newest failure.
    if (!prev || (!prev.ok && row.ok)) byDay.set(date, row);
  }
  return [...byDay.values()].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, HISTORY_DAYS);
}

function overallOf(states: StatusState[], dbDown: boolean): StatusState {
  if (dbDown) return 'down';
  return states.some((s) => s !== 'operational') ? 'degraded' : 'operational';
}

export async function buildSnapshot(deps: SnapshotDeps): Promise<StatusResponse> {
  const now = deps.now();
  const days = lastDays(now, HISTORY_DAYS);
  const since = new Date(now.getTime() - 20 * DAY_MS);
  const daysSince = new Date(Date.parse(`${days[0]}T00:00:00Z`));

  const [fresh, runs, lastSuccess, latest, reference, stats] = await Promise.all([
    getFreshness(deps.pool),
    getTrainRuns(deps.pool, since),
    getLastTrainSuccess(deps.pool),
    getLatestTrainRow(deps.pool),
    getReferenceTrainRun(deps.pool),
    getSampleStats(deps.pool, now, daysSince),
  ]);

  const c = componentStates(fresh, now);

  let running: Running | null = null;
  if (
    latest &&
    latest.finished_at === null &&
    (now.getTime() - latest.started_at.getTime()) / 1000 <= RUNNING_MAX_AGE_S
  ) {
    running = buildRunning(latest, reference ? buildReference(reference) : null, now);
  }
  const lastFinished = runs.find((r) => r.finished_at !== null);
  const models = modelsState({
    lastSuccessAgeS: ageS(lastSuccess, now),
    running: running !== null,
    stalled: running?.stalled ?? false,
    lastFinishedFailedAfterSuccess:
      !!lastFinished && lastFinished.ok === false && (!lastSuccess || lastFinished.finished_at! > lastSuccess),
  });

  const latency = deps.latency.bucket(now.getTime());
  const website: StatusState = latency === 'slow' ? 'degraded' : 'operational';

  const cells = (comp: StatusComponent): StatusDayCell[] =>
    days.map((d) => dayCell(d, stats.daily.get(dailyKey(comp, d)) ?? 0, stats.first.get(comp) ?? null, now));
  const [hWebsite, hStations, hForecasts, hDatabase] = STATUS_COMPONENTS.map(cells) as [
    StatusDayCell[],
    StatusDayCell[],
    StatusDayCell[],
    StatusDayCell[],
  ];

  const firstWebsite = stats.first.get('website') ?? null;
  return {
    overall: overallOf([website, c.stations, c.forecasts, models], false),
    website: { state: website, latency },
    stations: { state: c.stations, updated_min_ago: wholeMin(c.stationsAgeS) },
    forecasts: { state: c.forecasts, updated_min_ago: wholeMin(c.forecastsAgeS) },
    models: {
      state: models,
      last_update_date: lastSuccess ? utcDate(lastSuccess) : null,
      running:
        running && !running.stalled
          ? { percent: running.percent, stage: running.stage, eta_min: running.eta_min }
          : null,
    },
    database: { state: 'operational' },
    release: {
      deployed_ago: coarseAgo(now.getTime() - deps.deployedAt.getTime()),
      uptime_7d: uptimePct(stats.ok7, firstWebsite, now, 7 * DAY_MS),
      uptime_30d: uptimePct(stats.ok30, firstWebsite, now, 30 * DAY_MS),
    },
    history: { days, website: hWebsite, stations: hStations, forecasts: hForecasts, database: hDatabase },
    model_updates: modelUpdateRows(runs),
  };
}

/** Served (with 503) when the database cannot be queried. Nothing about the failure is included. */
export function unavailableSnapshot(deps: Pick<SnapshotDeps, 'now' | 'deployedAt'>): StatusResponse {
  const now = deps.now();
  const days = lastDays(now, HISTORY_DAYS);
  const none: StatusDayCell[] = days.map(() => 'none');
  return {
    overall: 'down',
    website: { state: 'degraded', latency: null },
    stations: { state: 'down', updated_min_ago: null },
    forecasts: { state: 'down', updated_min_ago: null },
    models: { state: 'down', last_update_date: null, running: null },
    database: { state: 'down' },
    release: {
      deployed_ago: coarseAgo(now.getTime() - deps.deployedAt.getTime()),
      uptime_7d: null,
      uptime_30d: null,
    },
    history: { days, website: none, stations: none, forecasts: none, database: none },
    model_updates: [],
  };
}
