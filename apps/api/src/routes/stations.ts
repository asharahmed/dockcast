/**
 * `docs/api.md` §2 — GET /stations/:id, GET /stations/:id/history.
 */
import { Router } from 'express';
import {
  stationDetailResponseSchema,
  stationHistoryResponseSchema,
  stationHistoryQuerySchema,
  type StationDetailResponse,
  type StationHistoryResponse,
  type StationForecastRow,
  type ServingTier,
} from '@dockcast/shared';
import type { RouteDeps } from '../deps.js';
import { sendJson } from '../lib/respond.js';
import { notFound } from '../middleware/errors.js';
import { parseIntParam, parseQuery } from '../lib/validate.js';
import { dayTypeOf, getHolidaySet } from '../forecast/holidays.js';
import {
  getStationDetail,
  getStationCurrent,
  getTypicalProfile,
  getNeighbors,
  getStationHistory,
} from '../services/stations.queries.js';
import { listForecastsForStation } from '../services/forecasts.queries.js';

function requireStationId(id: string | undefined): number {
  const n = parseIntParam(id);
  if (n === null) throw notFound('Unknown station');
  return n;
}

export function stationsRouter(deps: RouteDeps): Router {
  const router = Router();

  router.get('/stations/:id', async (req, res) => {
    const stationPk = requireStationId(req.params.id);
    const station = await getStationDetail(deps.pool, stationPk);
    if (!station) throw notFound(`Unknown station: ${req.params.id}`);

    const now = deps.now();
    const holidays = await getHolidaySet(
      deps.pool,
      station.city_holiday_country,
      station.city_holiday_subdiv,
    );
    const dayType = dayTypeOf(now, station.city_tz, holidays);

    const [current, forecastRows, typicalRows, neighborRows, historyRows] = await Promise.all([
      getStationCurrent(deps.pool, stationPk),
      listForecastsForStation(deps.pool, stationPk),
      getTypicalProfile(deps.pool, stationPk, dayType),
      getNeighbors(deps.pool, stationPk),
      getStationHistory(deps.pool, { stationPk, cityId: station.city_id, now, hours: 24 }),
    ]);

    const forecasts: StationForecastRow[] = forecastRows.map((r) => ({
      horizon: r.horizon,
      valid_at: r.valid_at.toISOString(),
      p_bike: r.p_bike,
      p_dock: r.p_dock,
      exp_bikes: r.exp_bikes,
      q10: r.q10,
      q90: r.q90,
      tier: r.tier as ServingTier,
      reason: r.reason,
    }));

    const body: StationDetailResponse = {
      station: {
        id: station.id,
        station_id: station.station_id,
        name: station.name,
        lat: station.lat,
        lon: station.lon,
        capacity: station.capacity,
        city: { slug: station.city_slug, name: station.city_name, tz: station.city_tz },
      },
      current: current
        ? {
            bikes: current.bikes,
            docks: current.docks,
            ebikes: current.ebikes,
            cap_eff: current.cap_eff,
            is_fresh: current.is_fresh,
            as_of: current.ts.toISOString(),
            last_reported: current.last_reported.toISOString(),
          }
        : null,
      forecasts,
      history: historyRows.map((h) => ({ ts: h.ts.toISOString(), bikes: h.bikes, docks: h.docks })),
      typical: typicalRows,
      neighbors: neighborRows,
    };
    sendJson(res, 200, stationDetailResponseSchema, body, deps.config, 'public, max-age=30');
  });

  router.get('/stations/:id/history', async (req, res) => {
    const stationPk = requireStationId(req.params.id);
    const station = await getStationDetail(deps.pool, stationPk);
    if (!station) throw notFound(`Unknown station: ${req.params.id}`);

    const query = parseQuery(stationHistoryQuerySchema, req.query);
    const now = deps.now();
    const points = await getStationHistory(deps.pool, {
      stationPk,
      cityId: station.city_id,
      now,
      hours: query.hours,
    });

    const body: StationHistoryResponse = {
      points: points.map((h) => ({ ts: h.ts.toISOString(), bikes: h.bikes, docks: h.docks })),
    };
    sendJson(res, 200, stationHistoryResponseSchema, body, deps.config, 'public, max-age=60');
  });

  return router;
}
