/**
 * Station status cycle (`docs/collector-spec.md` §3). Every `POLL_INTERVAL_MS`
 * per active city: fetch + normalise `station_status`, map ids, detect
 * changes against an in-memory `LastState` map (seeded from `station_current`
 * on cold start), then write `station_current` (all rows), `station_snapshots`
 * (changed rows only), `poll_log`, and `feed_state` in one transaction.
 */
import { unnestParams, type Pool, type UnnestColumn } from '@dockcast/db';
import type { Logger } from 'pino';
import { discover, fetchStationStatus } from './gbfs/adapter.js';
import type { LastState, NormalizedStationStatus, VehicleTypeMap } from './gbfs/types.js';
import { GbfsSchemaError } from './gbfs/types.js';
import type { FetchImpl } from './http.js';
import { loadLastStateFromCurrent, recordPollFailure, type CityRow } from './db.js';

const STATION_CURRENT_COLUMNS: UnnestColumn[] = [
  { name: 'station_pk', type: 'int' },
  { name: 'ts', type: 'timestamptz' },
  { name: 'bikes', type: 'smallint' },
  { name: 'docks', type: 'smallint' },
  { name: 'ebikes', type: 'smallint' },
  { name: 'bikes_disabled', type: 'smallint' },
  { name: 'docks_disabled', type: 'smallint' },
  { name: 'is_installed', type: 'boolean' },
  { name: 'is_renting', type: 'boolean' },
  { name: 'is_returning', type: 'boolean' },
  { name: 'last_reported', type: 'timestamptz' },
];

// ---------------------------------------------------------------------------
// §3.3 step 4: change detection
// ---------------------------------------------------------------------------

export function toLastState(row: NormalizedStationStatus): LastState {
  return {
    bikes: row.bikes,
    docks: row.docks,
    ebikes: row.ebikes,
    bikes_disabled: row.bikes_disabled,
    docks_disabled: row.docks_disabled,
    is_installed: row.is_installed,
    is_renting: row.is_renting,
    is_returning: row.is_returning,
    last_reported: row.last_reported.getTime(),
  };
}

/** All 9 non-ts fields must match; a missing `prev` (station absent from the map) is never equal. */
export function equal(prev: LastState | undefined, next: LastState): boolean {
  if (!prev) return false;
  return (
    prev.bikes === next.bikes &&
    prev.docks === next.docks &&
    prev.ebikes === next.ebikes &&
    prev.bikes_disabled === next.bikes_disabled &&
    prev.docks_disabled === next.docks_disabled &&
    prev.is_installed === next.is_installed &&
    prev.is_renting === next.is_renting &&
    prev.is_returning === next.is_returning &&
    prev.last_reported === next.last_reported
  );
}

export interface ChangeCandidate {
  station_pk: number;
  state: LastState;
}

/** `rows.filter(r => !equal(lastMap.get(r.station_pk), r.state))`. */
export function diffChanged<T extends ChangeCandidate>(
  lastMap: Map<number, LastState>,
  rows: T[],
): T[] {
  return rows.filter((r) => !equal(lastMap.get(r.station_pk), r.state));
}

// ---------------------------------------------------------------------------
// §3.3 steps 1-7 + §3.4 failure path
// ---------------------------------------------------------------------------

export interface StatusCycleParams {
  pool: Pool;
  city: CityRow;
  /** `gbfs station_id -> stations.id`; rows not present here are dropped and counted in `n_unknown`. */
  idMap: Map<string, number>;
  vehicleTypes: VehicleTypeMap | null;
  /** Mutated in place: seeded from `station_current` on cold start, updated for changed rows after commit. */
  lastState: Map<number, LastState>;
  logger: Logger;
  /** Injectable clock (docs/plan.md R9); this instant is written as `ts` for every row this cycle. */
  now?: Date;
  fetchImpl?: FetchImpl;
  timeoutMs?: number;
}

export interface StatusCycleResult {
  ok: boolean;
  n: number;
  n_changed: number;
  n_unknown: number;
  n_clamped: number;
  latency_ms: number;
  error?: string;
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function runStatusCycle(params: StatusCycleParams): Promise<StatusCycleResult> {
  const { pool, city, idMap, vehicleTypes, lastState, logger } = params;
  const t_start = Date.now();
  const now = params.now ?? new Date();

  try {
    const feeds = await discover(city.gbfs_url, {
      fetchImpl: params.fetchImpl,
      timeoutMs: params.timeoutMs,
      now,
    });
    const statusUrl = feeds.feeds.get('station_status');
    if (!statusUrl) {
      throw new GbfsSchemaError(`city ${city.slug}: discovery has no station_status feed`);
    }

    const { rows: normalised, n_clamped } = await fetchStationStatus(statusUrl, vehicleTypes, now, {
      fetchImpl: params.fetchImpl,
      timeoutMs: params.timeoutMs,
    });

    if (lastState.size === 0) {
      const seeded = await loadLastStateFromCurrent(pool, city.id);
      for (const [pk, state] of seeded) lastState.set(pk, state);
    }

    let n_unknown = 0;
    const mapped: Array<{ station_pk: number; row: NormalizedStationStatus; state: LastState }> = [];
    for (const row of normalised) {
      const pk = idMap.get(row.station_id);
      if (pk === undefined) {
        n_unknown++;
        continue;
      }
      mapped.push({ station_pk: pk, row, state: toLastState(row) });
    }

    const changed = diffChanged(lastState, mapped);
    const changedPks = new Set(changed.map((c) => c.station_pk));

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const currentCols = unnestParams(
        mapped.map((m) => ({ station_pk: m.station_pk, ts: now, ...rowColumns(m.row) })),
        STATION_CURRENT_COLUMNS,
      );
      await client.query(
        `INSERT INTO station_current (station_pk, ts, bikes, docks, ebikes, bikes_disabled, docks_disabled, is_installed, is_renting, is_returning, last_reported)
         SELECT * FROM ${currentCols.placeholders}
         ON CONFLICT (station_pk) DO UPDATE SET
           ts = EXCLUDED.ts, bikes = EXCLUDED.bikes, docks = EXCLUDED.docks, ebikes = EXCLUDED.ebikes,
           bikes_disabled = EXCLUDED.bikes_disabled, docks_disabled = EXCLUDED.docks_disabled,
           is_installed = EXCLUDED.is_installed, is_renting = EXCLUDED.is_renting,
           is_returning = EXCLUDED.is_returning, last_reported = EXCLUDED.last_reported`,
        currentCols.values,
      );

      if (changed.length > 0) {
        const changedRows = mapped.filter((m) => changedPks.has(m.station_pk));
        const snapCols = unnestParams(
          changedRows.map((m) => ({ station_pk: m.station_pk, ts: now, ...rowColumns(m.row) })),
          STATION_CURRENT_COLUMNS,
        );
        await client.query(
          `INSERT INTO station_snapshots (station_pk, ts, bikes, docks, ebikes, bikes_disabled, docks_disabled, is_installed, is_renting, is_returning, last_reported)
           SELECT * FROM ${snapCols.placeholders}
           ON CONFLICT (station_pk, ts) DO NOTHING`,
          snapCols.values,
        );
      }

      await client.query(
        `INSERT INTO poll_log (city_id, polled_at, feed, ok, n_items, latency_ms, error)
         VALUES ($1, $2, 'station_status', true, $3, $4, NULL)`,
        [city.id, now, mapped.length, Date.now() - t_start],
      );
      await client.query(
        `INSERT INTO feed_state (city_id, feed, last_attempt_at, last_ok_at, last_error)
         VALUES ($1, 'station_status', $2, $2, NULL)
         ON CONFLICT (city_id, feed) DO UPDATE SET
           last_attempt_at = EXCLUDED.last_attempt_at, last_ok_at = EXCLUDED.last_ok_at, last_error = NULL`,
        [city.id, now],
      );

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    // Only after commit: update the in-memory map for changed rows.
    for (const m of changed) {
      lastState.set(m.station_pk, m.state);
    }

    const latency_ms = Date.now() - t_start;
    const level = n_clamped > 0 ? 'warn' : 'info';
    logger[level]({
      event: 'status_cycle',
      city: city.slug,
      ok: true,
      n: mapped.length,
      n_changed: changed.length,
      n_unknown,
      n_clamped,
      latency_ms,
    });

    return { ok: true, n: mapped.length, n_changed: changed.length, n_unknown, n_clamped, latency_ms };
  } catch (err) {
    const latency_ms = Date.now() - t_start;
    const message = errMsg(err);
    await recordPollFailure(pool, city.id, 'station_status', now, latency_ms, message, logger);
    logger.info({ event: 'status_cycle', city: city.slug, ok: false, error: message, latency_ms });
    return { ok: false, n: 0, n_changed: 0, n_unknown: 0, n_clamped: 0, latency_ms, error: message };
  }
}

interface RowColumns {
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

function rowColumns(row: NormalizedStationStatus): RowColumns {
  return {
    bikes: row.bikes,
    docks: row.docks,
    ebikes: row.ebikes,
    bikes_disabled: row.bikes_disabled,
    docks_disabled: row.docks_disabled,
    is_installed: row.is_installed,
    is_renting: row.is_renting,
    is_returning: row.is_returning,
    last_reported: row.last_reported,
  };
}
