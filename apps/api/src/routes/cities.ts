/**
 * `docs/api.md` §2 — GET /cities, GET /cities/:slug/stations, GET /cities/:slug/map.
 */
import { Router } from 'express';
import {
  cityListResponseSchema,
  stationListResponseSchema,
  mapResponseSchema,
  HORIZONS,
  type CityListResponse,
  type StationListResponse,
  type MapResponse,
  type MapStation,
} from '@dockcast/shared';
import type { RouteDeps } from '../deps.js';
import { sendJson } from '../lib/respond.js';
import { notFound } from '../middleware/errors.js';
import { listCities, getCityBySlug } from '../services/cities.queries.js';
import { listActiveStations, listMapStations } from '../services/stations.queries.js';
import { listLatestForecastsForCity, latestT0ForCity } from '../services/forecasts.queries.js';
import { getCityCollectorLastOkAt } from '../services/worker.queries.js';

async function requireCity(deps: RouteDeps, slug: string | undefined) {
  if (!slug) throw notFound('Unknown city');
  const city = await getCityBySlug(deps.pool, slug);
  if (!city) throw notFound(`Unknown city: ${slug}`);
  return city;
}

export function citiesRouter(deps: RouteDeps): Router {
  const router = Router();

  router.get('/cities', async (_req, res) => {
    const rows = await listCities(deps.pool);
    const body: CityListResponse = {
      cities: rows.map((r) => ({
        slug: r.slug,
        name: r.name,
        tz: r.tz,
        lat: r.lat,
        lon: r.lon,
        forecasting_enabled: r.forecasting_enabled,
        station_count: r.station_count,
        last_status_ok_at: r.last_status_ok_at ? r.last_status_ok_at.toISOString() : null,
      })),
    };
    sendJson(res, 200, cityListResponseSchema, body, deps.config, 'public, max-age=300');
  });

  router.get('/cities/:slug/stations', async (req, res) => {
    const city = await requireCity(deps, req.params.slug);
    const stations = await listActiveStations(deps.pool, city.id);
    const body: StationListResponse = { stations };
    sendJson(res, 200, stationListResponseSchema, body, deps.config, 'public, max-age=3600');
  });

  router.get('/cities/:slug/map', async (req, res) => {
    const city = await requireCity(deps, req.params.slug);

    const [mapStations, forecastRows, t0, lastOkAt] = await Promise.all([
      listMapStations(deps.pool, city.id),
      listLatestForecastsForCity(deps.pool, city.id),
      latestT0ForCity(deps.pool, city.id),
      getCityCollectorLastOkAt(deps.pool, city.id),
    ]);

    const forecastsByStation = new Map<
      number,
      Map<number, { p_bike: number | null; p_dock: number | null; exp_bikes: number | null }>
    >();
    for (const row of forecastRows) {
      let byHorizon = forecastsByStation.get(row.station_pk);
      if (!byHorizon) {
        byHorizon = new Map();
        forecastsByStation.set(row.station_pk, byHorizon);
      }
      byHorizon.set(row.horizon, row);
    }

    const stations: MapStation[] = mapStations.map((s) => {
      const byHorizon = forecastsByStation.get(s.id);
      const f: MapStation['f'] = HORIZONS.map((h) => {
        const row = byHorizon?.get(h);
        if (!row || row.p_bike === null || row.p_dock === null || row.exp_bikes === null)
          return null;
        return [row.p_bike, row.p_dock, row.exp_bikes];
      });
      return { id: s.id, b: s.b, d: s.d, c: s.c, fresh: s.fresh, f };
    });

    // as_of must be a non-null string (docs/api.md §2 MapResponse); before the
    // first successful poll for this city there is no real "latest ok poll"
    // instant, so fall back to the injected clock (the stations array will be
    // empty in that case anyway, since stations without station_current are omitted).
    const asOf = lastOkAt ?? deps.now();

    const body: MapResponse = {
      t0: t0 ? t0.toISOString() : null,
      as_of: asOf.toISOString(),
      horizons: [...HORIZONS],
      stations,
    };
    sendJson(res, 200, mapResponseSchema, body, deps.config, 'public, max-age=30');
  });

  return router;
}
