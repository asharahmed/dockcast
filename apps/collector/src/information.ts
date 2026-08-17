/**
 * Station information sync (`docs/collector-spec.md` §4). On boot, then every
 * `INFO_INTERVAL_MS`: fetch + normalise `station_information`, upsert
 * `stations`, deactivate stations no longer present, then (only after commit)
 * rebuild the id map and refresh the `VehicleTypeMap`.
 */
import { many, unnestParams, type Pool, type UnnestColumn } from '@dockcast/db';
import type { Logger } from 'pino';
import { discover, fetchStationInformation, fetchVehicleTypes } from './gbfs/adapter.js';
import { GbfsSchemaError, type VehicleTypeMap } from './gbfs/types.js';
import type { FetchImpl } from './http.js';
import { recordPollFailure, type CityRow } from './db.js';

const STATION_COLUMNS: UnnestColumn[] = [
  { name: 'city_id', type: 'int' },
  { name: 'station_id', type: 'text' },
  { name: 'name', type: 'text' },
  { name: 'lat', type: 'float8' },
  { name: 'lon', type: 'float8' },
  { name: 'capacity', type: 'int' },
];

export interface InformationSyncParams {
  pool: Pool;
  city: CityRow;
  /** Mutated in place: cleared and rebuilt from `stations` after a successful sync. */
  idMap: Map<string, number>;
  /** Mutable box: on a successful `vehicle_types` fetch, `.current` is replaced; on failure it is left untouched. */
  vehicleTypesRef: { current: VehicleTypeMap | null };
  logger: Logger;
  now?: Date;
  fetchImpl?: FetchImpl;
  timeoutMs?: number;
}

export interface InformationSyncResult {
  ok: boolean;
  n: number;
  error?: string;
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function runInformationSync(params: InformationSyncParams): Promise<InformationSyncResult> {
  const { pool, city, idMap, vehicleTypesRef, logger } = params;
  const t_start = Date.now();
  const now = params.now ?? new Date();

  try {
    const feeds = await discover(city.gbfs_url, {
      fetchImpl: params.fetchImpl,
      timeoutMs: params.timeoutMs,
      now,
    });
    const infoUrl = feeds.feeds.get('station_information');
    if (!infoUrl) {
      throw new GbfsSchemaError(`city ${city.slug}: discovery has no station_information feed`);
    }

    const { stations: infos } = await fetchStationInformation(infoUrl, {
      fetchImpl: params.fetchImpl,
      timeoutMs: params.timeoutMs,
    });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const cols = unnestParams(
        infos.map((s) => ({
          city_id: city.id,
          station_id: s.station_id,
          name: s.name,
          lat: s.lat,
          lon: s.lon,
          capacity: s.capacity,
        })),
        STATION_COLUMNS,
      );
      await client.query(
        `INSERT INTO stations (city_id, station_id, name, lat, lon, capacity, is_active, first_seen_at, last_seen_at)
         SELECT *, true, now(), now() FROM ${cols.placeholders}
         ON CONFLICT (city_id, station_id) DO UPDATE SET
           name = EXCLUDED.name, lat = EXCLUDED.lat, lon = EXCLUDED.lon, capacity = EXCLUDED.capacity,
           is_active = true, last_seen_at = now()`,
        cols.values,
      );

      await client.query(
        `UPDATE stations SET is_active = false
         WHERE city_id = $1 AND is_active AND NOT (station_id = ANY($2::text[]))`,
        [city.id, infos.map((s) => s.station_id)],
      );

      await client.query(
        `INSERT INTO poll_log (city_id, polled_at, feed, ok, n_items, latency_ms, error)
         VALUES ($1, $2, 'station_information', true, $3, $4, NULL)`,
        [city.id, now, infos.length, Date.now() - t_start],
      );
      await client.query(
        `INSERT INTO feed_state (city_id, feed, last_attempt_at, last_ok_at, last_error)
         VALUES ($1, 'station_information', $2, $2, NULL)
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

    // Only after commit: rebuild the id map (include inactive stations).
    const rows = await many<{ id: number; station_id: string }>(
      pool,
      'SELECT id, station_id FROM stations WHERE city_id = $1',
      [city.id],
    );
    idMap.clear();
    for (const r of rows) idMap.set(r.station_id, r.id);

    // Refresh the VehicleTypeMap; failure is non-fatal and keeps the previous map.
    const vtUrl = feeds.feeds.get('vehicle_types');
    if (vtUrl) {
      try {
        vehicleTypesRef.current = await fetchVehicleTypes(vtUrl, {
          fetchImpl: params.fetchImpl,
          timeoutMs: params.timeoutMs,
        });
      } catch (err) {
        logger.warn(
          { event: 'vehicle_types_refresh_failed', city: city.slug, error: errMsg(err) },
          'vehicle_types refresh failed, keeping the previous map',
        );
      }
    }

    const latency_ms = Date.now() - t_start;
    logger.info({ event: 'information_sync', city: city.slug, ok: true, n: infos.length, latency_ms });
    return { ok: true, n: infos.length };
  } catch (err) {
    const latency_ms = Date.now() - t_start;
    const message = errMsg(err);
    await recordPollFailure(pool, city.id, 'station_information', now, latency_ms, message, logger);
    logger.info({ event: 'information_sync', city: city.slug, ok: false, error: message, latency_ms });
    return { ok: false, n: 0, error: message };
  }
}
