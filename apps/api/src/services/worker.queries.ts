/**
 * `feed_state`, `poll_log`, `worker_runs`, `station_snapshots` — system/collector/predictor
 * health signals used by `GET /health` (global) and `GET /model` (per city). `docs/api.md` §1, §4.
 */
import type { Pool } from '@dockcast/db';
import { one, maybeOne } from '@dockcast/db';

export async function getGlobalCollectorLastOkAt(pool: Pool): Promise<Date | null> {
  const row = await one<{ last_ok_at: Date | null }>(
    pool,
    `SELECT max(last_ok_at) AS last_ok_at FROM feed_state WHERE feed = 'station_status'`,
  );
  return row.last_ok_at;
}

export async function getGlobalPredictorLastRunAt(pool: Pool): Promise<Date | null> {
  const row = await one<{ finished_at: Date | null }>(
    pool,
    `SELECT max(finished_at) AS finished_at FROM worker_runs WHERE kind = 'predict' AND finished_at IS NOT NULL`,
  );
  return row.finished_at;
}

export async function getCityCollectorLastOkAt(pool: Pool, cityId: number): Promise<Date | null> {
  const row = await one<{ last_ok_at: Date | null }>(
    pool,
    `SELECT max(last_ok_at) AS last_ok_at FROM feed_state WHERE city_id = $1 AND feed = 'station_status'`,
    [cityId],
  );
  return row.last_ok_at;
}

export async function getCityPredictorLastRunAt(pool: Pool, cityId: number): Promise<Date | null> {
  const row = await one<{ finished_at: Date | null }>(
    pool,
    `SELECT max(finished_at) AS finished_at FROM worker_runs
     WHERE kind = 'predict' AND city_id = $1 AND finished_at IS NOT NULL`,
    [cityId],
  );
  return row.finished_at;
}

/**
 * `uptime = ok polls / expected polls (10080) over last 7 d` (`docs/api.md` §4).
 * `null` if the collector has never polled this city's `station_status` feed at all.
 */
export async function getCollectorUptime7d(
  pool: Pool,
  cityId: number,
  now: Date,
): Promise<number | null> {
  const row = await one<{ total: number; ok_recent: number; first_recent: Date | null }>(
    pool,
    `SELECT
       count(*) AS total,
       count(*) FILTER (
         WHERE ok AND polled_at >= $2::timestamptz - interval '7 days' AND polled_at <= $2::timestamptz
       ) AS ok_recent,
       min(polled_at) FILTER (
         WHERE polled_at >= $2::timestamptz - interval '7 days' AND polled_at <= $2::timestamptz
       ) AS first_recent
     FROM poll_log WHERE city_id = $1 AND feed = 'station_status'`,
    [cityId, now],
  );
  if (row.total === 0) return null;
  // Expected polls = one per minute over the part of the 7-day window in which the collector
  // existed (so a collector that started 2 days ago is scored against 2 days, not 7).
  const windowStart = new Date(now.getTime() - 7 * 24 * 60 * 60_000);
  const effectiveStart =
    row.first_recent && row.first_recent > windowStart ? row.first_recent : windowStart;
  const expected = Math.max(1, Math.round((now.getTime() - effectiveStart.getTime()) / 60_000));
  return Math.min(1, row.ok_recent / expected);
}

/** `min(station_snapshots.ts)` for a city's stations — `docs/api.md` §4 `data_since`; `null` if none yet. */
export async function getDataSince(pool: Pool, cityId: number): Promise<Date | null> {
  const row = await one<{ min_ts: Date | null }>(
    pool,
    `SELECT min(ss.ts) AS min_ts FROM station_snapshots ss JOIN stations s ON s.id = ss.station_pk WHERE s.city_id = $1`,
    [cityId],
  );
  return row.min_ts;
}

export async function getActiveStationCount(pool: Pool, cityId: number): Promise<number> {
  const row = await one<{ n: number }>(
    pool,
    `SELECT count(*)::int AS n FROM stations WHERE city_id = $1 AND is_active`,
    [cityId],
  );
  return row.n;
}

/**
 * The tier actually serving `forecasts_latest` for this city right now;
 * `'none'` if no rows yet. Within one predictor cycle every station shares
 * the same `t0`, but a per-station `'none'` (stale/no-rates station) can
 * coexist with the cycle's real tier on other rows — prefer a non-`'none'`
 * row at the latest `t0` so a tie doesn't nondeterministically surface a
 * per-station fallback as if it were the city's serving tier.
 */
export async function getServingTier(pool: Pool, cityId: number): Promise<string> {
  const row = await maybeOne<{ tier: string }>(
    pool,
    `SELECT fl.tier FROM forecasts_latest fl JOIN stations s ON s.id = fl.station_pk
     WHERE s.city_id = $1 ORDER BY (fl.tier <> 'none') DESC, fl.t0 DESC LIMIT 1`,
    [cityId],
  );
  return row?.tier ?? 'none';
}
