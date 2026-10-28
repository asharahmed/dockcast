/**
 * Component states and the time arithmetic for `GET /status`. Pure functions; the thresholds
 * here are the ones documented in `docs/api.md`.
 */
import type { StatusDayCell, StatusState } from '@dockcast/shared';

export const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

/** Collector polls every 60 s: fresh within 5 min, degraded within 15, then down. */
export const STATIONS_OK_S = 5 * 60;
export const STATIONS_DEGRADED_S = 15 * 60;
/** The predict loop runs every <= 15 min: fresh within 30 min, degraded within 90, then down. */
export const FORECASTS_OK_S = 30 * 60;
export const FORECASTS_DEGRADED_S = 90 * 60;
/** Nightly trainer: fine within 36 h of the last success, degraded within 96 h, then down. */
export const MODELS_OK_S = 36 * 3600;
export const MODELS_DEGRADED_S = 96 * 3600;
/** A day shows as up when at least this share of its minutes has an ok sample. */
export const DAY_OK_RATIO = 0.99;
/** Uptime needs at least this many minutes of history before a percentage is shown. */
export const UPTIME_MIN_MINUTES = 10;

export const ageS = (d: Date | null, now: Date): number | null =>
  d ? Math.max(0, Math.round((now.getTime() - d.getTime()) / 1000)) : null;

export function stationsState(age: number | null): StatusState {
  if (age === null) return 'down';
  return age <= STATIONS_OK_S ? 'operational' : age <= STATIONS_DEGRADED_S ? 'degraded' : 'down';
}

export function forecastsState(age: number | null, lastRunOk: boolean | null): StatusState {
  if (age === null) return 'down';
  const base: StatusState =
    age <= FORECASTS_OK_S ? 'operational' : age <= FORECASTS_DEGRADED_S ? 'degraded' : 'down';
  return base === 'operational' && lastRunOk === false ? 'degraded' : base;
}

export function modelsState(opts: {
  lastSuccessAgeS: number | null;
  running: boolean;
  stalled: boolean;
  lastFinishedFailedAfterSuccess: boolean;
}): StatusState {
  const { lastSuccessAgeS: age } = opts;
  if (opts.stalled) return 'degraded';
  if (age === null) return opts.running ? 'operational' : 'degraded';
  if (age > MODELS_DEGRADED_S) return 'down';
  if (age > MODELS_OK_S) return 'degraded';
  return opts.lastFinishedFailedAfterSuccess && !opts.running ? 'degraded' : 'operational';
}

/** Coarse "N units ago": minutes under 2 h, hours under 2 d, otherwise days. */
export function coarseAgo(ms: number): { value: number; unit: 'minutes' | 'hours' | 'days' } {
  const m = Math.max(0, Math.round(ms / MINUTE_MS));
  if (m < 120) return { value: m, unit: 'minutes' };
  const h = Math.round(m / 60);
  if (h < 48) return { value: h, unit: 'hours' };
  return { value: Math.round(h / 24), unit: 'days' };
}

/**
 * Uptime over `windowMs`: ok samples over the minutes that should have a sample. A minute with no
 * sample counts as down (the sampler lives in the API, so an API or database outage leaves a gap).
 * The window starts at the first sample ever taken so a fresh install is not shown as mostly down.
 * Floored to one decimal so the figure never overstates.
 */
export function uptimePct(
  okCount: number,
  firstSampleAt: Date | null,
  now: Date,
  windowMs: number,
): number | null {
  if (!firstSampleAt) return null;
  const start = Math.max(now.getTime() - windowMs, firstSampleAt.getTime());
  const expected = Math.floor((now.getTime() - start) / MINUTE_MS);
  if (expected < UPTIME_MIN_MINUTES) return null;
  const pct = Math.min(100, (okCount / expected) * 100);
  return Math.floor(pct * 10) / 10;
}

export const utcDate = (d: Date): string => d.toISOString().slice(0, 10);

/** The 14 UTC dates ending today, oldest first. */
export function lastDays(now: Date, n = 14): string[] {
  const todayStart = Date.parse(`${utcDate(now)}T00:00:00Z`);
  return Array.from({ length: n }, (_, i) => utcDate(new Date(todayStart - (n - 1 - i) * DAY_MS)));
}

/** Cell for one UTC `day` given its ok-sample count and the first sample ever taken. */
export function dayCell(
  day: string,
  okCount: number,
  firstSampleAt: Date | null,
  now: Date,
): StatusDayCell {
  if (!firstSampleAt) return 'none';
  const dayStart = Date.parse(`${day}T00:00:00Z`);
  const from = Math.max(dayStart, firstSampleAt.getTime());
  const to = Math.min(dayStart + DAY_MS, now.getTime());
  const expected = Math.floor((to - from) / MINUTE_MS);
  if (expected < 1) return 'none';
  return okCount / expected >= DAY_OK_RATIO ? 'ok' : 'down';
}
