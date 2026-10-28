/**
 * Reads behind `GET /status` and the status sampler. The public route must never select
 * `worker_runs.error`, `worker_runs.summary` as a whole, or anything in the stored progress other
 * than phase names and timestamps, so the progress JSON is cut down inside SQL.
 */
import type { Pool } from '@dockcast/db';
import { many, maybeOne, none, one } from '@dockcast/db';

/** `summary.progress` reduced to `{updated_at, phases: [{phase, ts}]}`; memory and attempt fields stay in the DB. */
const SAFE_PROGRESS = `
  jsonb_build_object(
    'updated_at', summary->'progress'->'updated_at',
    'phases', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('phase', p->'phase', 'ts', p->'ts'))
      FROM jsonb_array_elements(
        CASE WHEN jsonb_typeof(summary->'progress'->'phases') = 'array'
             THEN summary->'progress'->'phases' ELSE '[]'::jsonb END) AS p
    ), '[]'::jsonb)
  )`;

export interface Freshness {
  collector_ok_at: Date | null;
  predict_at: Date | null;
  predict_ok: boolean | null;
}

export async function getFreshness(pool: Pool): Promise<Freshness> {
  return one<Freshness>(
    pool,
    `SELECT c.at AS collector_ok_at, p.finished_at AS predict_at, p.ok AS predict_ok
     FROM (SELECT max(last_ok_at) AS at FROM feed_state WHERE feed = 'station_status') c
     LEFT JOIN LATERAL (
       SELECT finished_at, ok FROM worker_runs
       WHERE kind = 'predict' AND finished_at IS NOT NULL
       ORDER BY finished_at DESC LIMIT 1) p ON true`,
  );
}

export interface FinishedTrainRow {
  started_at: Date;
  finished_at: Date | null;
  ok: boolean | null;
}

/** Train rows since `since`, newest first. No summary, no error. */
export async function getTrainRuns(pool: Pool, since: Date): Promise<FinishedTrainRow[]> {
  return many<FinishedTrainRow>(
    pool,
    `SELECT started_at, finished_at, ok FROM worker_runs
     WHERE kind = 'train' AND started_at >= $1
     ORDER BY started_at DESC LIMIT 200`,
    [since],
  );
}

export async function getLastTrainSuccess(pool: Pool): Promise<Date | null> {
  const r = await one<{ at: Date | null }>(
    pool,
    `SELECT max(finished_at) AS at FROM worker_runs
     WHERE kind = 'train' AND ok AND finished_at IS NOT NULL`,
  );
  return r.at;
}

/** The newest train row of all, with sanitized progress; the caller decides if it is still running. */
export async function getLatestTrainRow(
  pool: Pool,
): Promise<{ started_at: Date; finished_at: Date | null; progress: unknown } | null> {
  return maybeOne(
    pool,
    `SELECT started_at, finished_at, ${SAFE_PROGRESS} AS progress
     FROM worker_runs WHERE kind = 'train' ORDER BY started_at DESC LIMIT 1`,
  );
}

/** The most recent successful run that recorded phase timestamps (percent/ETA reference). */
export async function getReferenceTrainRun(
  pool: Pool,
): Promise<{ started_at: Date; finished_at: Date | null; progress: unknown } | null> {
  return maybeOne(
    pool,
    `SELECT started_at, finished_at, ${SAFE_PROGRESS} AS progress
     FROM worker_runs
     WHERE kind = 'train' AND ok AND finished_at IS NOT NULL
       AND jsonb_typeof(summary->'progress'->'phases') = 'array'
     ORDER BY started_at DESC LIMIT 1`,
  );
}

export const STATUS_COMPONENTS = ['website', 'stations', 'forecasts', 'database'] as const;
export type StatusComponent = (typeof STATUS_COMPONENTS)[number];

/** One row per minute and component; the primary key makes concurrent instances idempotent. */
export async function insertSamples(
  pool: Pool,
  at: Date,
  samples: { component: StatusComponent; ok: boolean }[],
): Promise<void> {
  await none(
    pool,
    `INSERT INTO status_samples (ts, component, ok)
     SELECT date_trunc('minute', $1::timestamptz), c, o
     FROM unnest($2::text[], $3::boolean[]) AS t(c, o)
     ON CONFLICT DO NOTHING`,
    [at, samples.map((s) => s.component), samples.map((s) => s.ok)],
  );
}

export interface SampleStats {
  /** First sample ever kept, per component. */
  first: Map<string, Date>;
  ok7: number;
  ok30: number;
  /** ok-sample counts per component and UTC date (`YYYY-MM-DD`) since `daysSince`. */
  daily: Map<string, number>;
}

export const dailyKey = (component: string, day: string): string => `${component}|${day}`;

export async function getSampleStats(pool: Pool, now: Date, daysSince: Date): Promise<SampleStats> {
  const [firsts, uptime, daily] = await Promise.all([
    many<{ component: string; first: Date }>(
      pool,
      `SELECT component, min(ts) AS first FROM status_samples GROUP BY component`,
    ),
    one<{ ok7: string; ok30: string }>(
      pool,
      `SELECT count(*) FILTER (WHERE ts > $1::timestamptz - interval '7 days') AS ok7,
              count(*) AS ok30
       FROM status_samples
       WHERE component = 'website' AND ok AND ts > $1::timestamptz - interval '30 days'`,
      [now],
    ),
    many<{ component: string; day: string; ok_n: string }>(
      pool,
      `SELECT component, to_char(ts AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day, count(*) AS ok_n
       FROM status_samples WHERE ok AND ts >= $1 GROUP BY 1, 2`,
      [daysSince],
    ),
  ]);
  return {
    first: new Map(firsts.map((r) => [r.component, r.first])),
    ok7: Number(uptime.ok7),
    ok30: Number(uptime.ok30),
    daily: new Map(daily.map((r) => [dailyKey(r.component, r.day), Number(r.ok_n)])),
  };
}
