/**
 * `forecasts_latest` table. `docs/api.md` §2 (`MapResponse`), §2 (`StationDetailResponse.forecasts`), §3 (`forecast_t0`).
 */
import type { Pool } from '@dockcast/db';
import { many, one } from '@dockcast/db';

export interface MapForecastRow {
  station_pk: number;
  horizon: number;
  p_bike: number | null;
  p_dock: number | null;
  exp_bikes: number | null;
}

/** All `forecasts_latest` rows for a city's active stations, across all horizons. */
export async function listLatestForecastsForCity(
  pool: Pool,
  cityId: number,
): Promise<MapForecastRow[]> {
  return many<MapForecastRow>(
    pool,
    `SELECT fl.station_pk, fl.horizon, fl.p_bike, fl.p_dock, fl.exp_bikes
     FROM forecasts_latest fl
     JOIN stations s ON s.id = fl.station_pk
     WHERE s.city_id = $1 AND s.is_active
     ORDER BY fl.station_pk, fl.horizon`,
    [cityId],
  );
}

/** Predictor origin `t0` — `null` before the first predictor run for this city (no rows yet). */
export async function latestT0ForCity(pool: Pool, cityId: number): Promise<Date | null> {
  const row = await one<{ t0: Date | null }>(
    pool,
    `SELECT max(fl.t0) AS t0 FROM forecasts_latest fl JOIN stations s ON s.id = fl.station_pk
     WHERE s.city_id = $1 AND s.is_active`,
    [cityId],
  );
  return row.t0;
}

export interface StationForecastDetailRow {
  horizon: number;
  valid_at: Date;
  p_bike: number | null;
  p_dock: number | null;
  exp_bikes: number | null;
  q10: number | null;
  q90: number | null;
  tier: string;
  reason: string | null;
}

/** 0-6 rows (one per horizon that has been upserted; empty before the first predictor run for this station). */
export async function listForecastsForStation(
  pool: Pool,
  stationPk: number,
): Promise<StationForecastDetailRow[]> {
  return many<StationForecastDetailRow>(
    pool,
    `SELECT horizon, valid_at, p_bike, p_dock, exp_bikes, q10, q90, tier, reason
     FROM forecasts_latest WHERE station_pk = $1 ORDER BY horizon`,
    [stationPk],
  );
}
