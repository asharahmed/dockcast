/**
 * `stations`, `station_current`, `station_state_fresh`, `station_snapshots`,
 * `station_tod_profile`, `station_neighbors`. `docs/api.md` §2.
 */
import type { Pool } from '@dockcast/db';
import { many, maybeOne } from '@dockcast/db';

export interface StationListRow {
  id: number;
  station_id: string;
  name: string;
  lat: number;
  lon: number;
  capacity: number | null;
}

export async function listActiveStations(pool: Pool, cityId: number): Promise<StationListRow[]> {
  return many<StationListRow>(
    pool,
    `SELECT id, station_id, name, lat, lon, capacity FROM stations
     WHERE city_id = $1 AND is_active ORDER BY name`,
    [cityId],
  );
}

export interface MapStationRow {
  id: number;
  b: number;
  d: number;
  c: number;
  fresh: boolean;
}

/** Active stations with a `station_current` row (stations without one are omitted — `docs/api.md` §2 `MapResponse`). */
export async function listMapStations(pool: Pool, cityId: number): Promise<MapStationRow[]> {
  return many<MapStationRow>(
    pool,
    `SELECT s.id AS id, sc.bikes AS b, sc.docks AS d, (sc.bikes + sc.docks)::int AS c,
            coalesce(ssf.is_fresh, false) AS fresh
     FROM stations s
     JOIN station_current sc ON sc.station_pk = s.id
     LEFT JOIN station_state_fresh ssf ON ssf.station_pk = s.id
     WHERE s.city_id = $1 AND s.is_active
     ORDER BY s.id`,
    [cityId],
  );
}

export interface StationDetailRow {
  id: number;
  station_id: string;
  name: string;
  lat: number;
  lon: number;
  capacity: number | null;
  city_id: number;
  city_slug: string;
  city_name: string;
  city_tz: string;
  city_holiday_country: string;
  city_holiday_subdiv: string | null;
}

export async function getStationDetail(
  pool: Pool,
  stationPk: number,
): Promise<StationDetailRow | null> {
  return maybeOne<StationDetailRow>(
    pool,
    `SELECT s.id, s.station_id, s.name, s.lat, s.lon, s.capacity, s.city_id,
            c.slug AS city_slug, c.name AS city_name, c.tz AS city_tz,
            c.holiday_country AS city_holiday_country, c.holiday_subdiv AS city_holiday_subdiv
     FROM stations s JOIN cities c ON c.id = s.city_id
     WHERE s.id = $1`,
    [stationPk],
  );
}

export interface StationCurrentRow {
  bikes: number;
  docks: number;
  ebikes: number | null;
  cap_eff: number;
  is_fresh: boolean;
  ts: Date;
  last_reported: Date;
}

export async function getStationCurrent(
  pool: Pool,
  stationPk: number,
): Promise<StationCurrentRow | null> {
  return maybeOne<StationCurrentRow>(
    pool,
    `SELECT bikes, docks, ebikes, cap_eff, is_fresh, ts, last_reported
     FROM station_state_fresh WHERE station_pk = $1`,
    [stationPk],
  );
}

export interface TypicalRow {
  bucket: number;
  mean_fill: number | null;
  p_bike: number | null;
  p_dock: number | null;
}

/** 96 rows for `dayType` (`0..2`); `[]` if the profile hasn't been built yet. */
export async function getTypicalProfile(
  pool: Pool,
  stationPk: number,
  dayType: number,
): Promise<TypicalRow[]> {
  return many<TypicalRow>(
    pool,
    `SELECT bucket, mean_fill, p_bike, p_dock FROM station_tod_profile
     WHERE station_pk = $1 AND day_type = $2 ORDER BY bucket`,
    [stationPk, dayType],
  );
}

export interface NeighborRow {
  id: number;
  name: string;
  distance_m: number;
  bikes: number | null;
  docks: number | null;
}

export async function getNeighbors(pool: Pool, stationPk: number): Promise<NeighborRow[]> {
  return many<NeighborRow>(
    pool,
    `SELECT n.neighbor_pk AS id, s.name, n.distance_m, sc.bikes, sc.docks
     FROM station_neighbors n
     JOIN stations s ON s.id = n.neighbor_pk
     LEFT JOIN station_current sc ON sc.station_pk = n.neighbor_pk
     WHERE n.station_pk = $1
     ORDER BY n.rank`,
    [stationPk],
  );
}

export interface HistoryPointRow {
  ts: Date;
  bikes: number;
  docks: number;
}

/** Floor `d` to the nearest 5-minute UTC boundary (grid alignment for history charts, matching the predictor's `t0` convention). */
function floorToFiveMinutes(d: Date): Date {
  const stepMs = 5 * 60 * 1000;
  return new Date(Math.floor(d.getTime() / stepMs) * stepMs);
}

/**
 * Last `hours` on a 5-min grid via as-of/ffill from `station_snapshots`
 * (`generate_series` + lateral latest row `<= grid point`), masking grid
 * points with no successful `station_status` poll within 90 s (`poll_log`) —
 * masked/gap points are simply absent from the result, not nulled, since
 * `bikes`/`docks` are non-nullable in `StationHistoryPoint`.
 */
export async function getStationHistory(
  pool: Pool,
  args: { stationPk: number; cityId: number; now: Date; hours: number },
): Promise<HistoryPointRow[]> {
  const end = floorToFiveMinutes(args.now);
  const start = new Date(end.getTime() - args.hours * 60 * 60 * 1000);
  return many<HistoryPointRow>(
    pool,
    `WITH grid AS (
       SELECT generate_series($2::timestamptz, $3::timestamptz, interval '5 minutes') AS ts
     )
     SELECT g.ts, snap.bikes, snap.docks
     FROM grid g
     JOIN LATERAL (
       SELECT bikes, docks FROM station_snapshots
       WHERE station_pk = $1 AND ts <= g.ts
       ORDER BY ts DESC LIMIT 1
     ) snap ON true
     WHERE EXISTS (
       SELECT 1 FROM poll_log pl
       WHERE pl.city_id = $4 AND pl.feed = 'station_status' AND pl.ok = true
         AND pl.polled_at BETWEEN g.ts - interval '90 seconds' AND g.ts
     )
     ORDER BY g.ts`,
    [args.stationPk, start, end, args.cityId],
  );
}
