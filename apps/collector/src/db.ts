/**
 * `createPool()` from `@dockcast/db` plus DB helpers used only by the
 * collector (`docs/collector-spec.md` §1). No SQL beyond simple reads lives
 * here — the per-feed write transactions live in `status.ts` / `information.ts`
 * / `weather.ts`, but the shared failure-path write (§3.4, reused by §4.5/§5)
 * lives here since it is identical for every feed.
 */
import { createPool as createBasePool, many, type Pool } from '@dockcast/db';
import type { Logger } from 'pino';
import type { LastState } from './gbfs/types.js';

/** `pg.Pool` configured for the collector (`max: 5`, per collector-spec.md §1). */
export function createPool(databaseUrl: string): Pool {
  return createBasePool(databaseUrl, { max: 5, applicationName: 'dockcast-collector' });
}

export interface CityRow {
  id: number;
  slug: string;
  gbfs_url: string;
  tz: string;
  lat: number;
  lon: number;
}

/** Active cities, optionally filtered to `slugs` (`CITIES` env var; unset = all active). */
export async function loadActiveCities(pool: Pool, slugs?: string[]): Promise<CityRow[]> {
  if (slugs && slugs.length > 0) {
    return many<CityRow>(
      pool,
      'SELECT id, slug, gbfs_url, tz, lat, lon FROM cities WHERE is_active AND slug = ANY($1::text[]) ORDER BY id',
      [slugs],
    );
  }
  return many<CityRow>(
    pool,
    'SELECT id, slug, gbfs_url, tz, lat, lon FROM cities WHERE is_active ORDER BY id',
    [],
  );
}

/** `gbfs station_id -> stations.id`, including inactive stations (collector-spec.md §4.3). */
export async function loadIdMap(pool: Pool, cityId: number): Promise<Map<string, number>> {
  const rows = await many<{ id: number; station_id: string }>(
    pool,
    'SELECT id, station_id FROM stations WHERE city_id = $1',
    [cityId],
  );
  return new Map(rows.map((r) => [r.station_id, r.id]));
}

interface LastStateRow {
  station_pk: number;
  bikes: number;
  docks: number;
  ebikes: number | null;
  bikes_disabled: number | null;
  docks_disabled: number | null;
  is_installed: boolean;
  is_renting: boolean;
  is_returning: boolean;
  last_reported: Date;
}

/** Cold-start seed for the in-memory change-detection map (collector-spec.md §3.3 step 4). */
export async function loadLastStateFromCurrent(
  pool: Pool,
  cityId: number,
): Promise<Map<number, LastState>> {
  const rows = await many<LastStateRow>(
    pool,
    `SELECT sc.station_pk, sc.bikes, sc.docks, sc.ebikes, sc.bikes_disabled, sc.docks_disabled,
            sc.is_installed, sc.is_renting, sc.is_returning, sc.last_reported
     FROM station_current sc
     JOIN stations s ON s.id = sc.station_pk
     WHERE s.city_id = $1`,
    [cityId],
  );
  const map = new Map<number, LastState>();
  for (const r of rows) {
    map.set(r.station_pk, {
      bikes: r.bikes,
      docks: r.docks,
      ebikes: r.ebikes,
      bikes_disabled: r.bikes_disabled,
      docks_disabled: r.docks_disabled,
      is_installed: r.is_installed,
      is_renting: r.is_renting,
      is_returning: r.is_returning,
      last_reported: r.last_reported.getTime(),
    });
  }
  return map;
}

/**
 * Failure path shared by every feed (collector-spec.md §3.4, reused by §4.5
 * and §5): a short separate transaction writing `poll_log(ok=false)` +
 * `feed_state.last_error` (never touching `last_ok_at`). If even this write
 * fails (DB down), log at `error` and swallow — never rethrow out of a cycle.
 */
export async function recordPollFailure(
  pool: Pool,
  cityId: number,
  feed: string,
  attemptedAt: Date,
  latencyMs: number,
  message: string,
  logger: Logger,
): Promise<void> {
  const truncated = message.length > 500 ? message.slice(0, 500) : message;
  try {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO poll_log (city_id, polled_at, feed, ok, n_items, latency_ms, error)
         VALUES ($1, $2, $3, false, NULL, $4, $5)`,
        [cityId, attemptedAt, feed, latencyMs, truncated],
      );
      await client.query(
        `INSERT INTO feed_state (city_id, feed, last_attempt_at, last_error)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (city_id, feed) DO UPDATE SET
           last_attempt_at = EXCLUDED.last_attempt_at,
           last_error = EXCLUDED.last_error`,
        [cityId, feed, attemptedAt, truncated],
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  } catch (writeErr) {
    logger.error(
      {
        event: 'poll_log_write_failed',
        city_id: cityId,
        feed,
        error: writeErr instanceof Error ? writeErr.message : String(writeErr),
      },
      'failed to record poll failure in the database',
    );
  }
}
