/**
 * `docs/api.md` §3 — GET /trip.
 */
import { Router } from 'express';
import {
  tripQuerySchema,
  tripResponseSchema,
  rideMinutesDefault,
  type TripResponse,
  type TripLeg,
} from '@dockcast/shared';
import type { RouteDeps } from '../deps.js';
import { sendJson } from '../lib/respond.js';
import { validationError, notFound } from '../middleware/errors.js';
import { parseQuery } from '../lib/validate.js';
import { createRateLimiter } from '../middleware/rateLimit.js';
import { getStationDetail } from '../services/stations.queries.js';
import { latestT0ForCity } from '../services/forecasts.queries.js';
import { lookup } from '../forecast/lookup.js';
import { alternatives } from '../forecast/alternatives.js';
import { computeVerdict } from '../forecast/verdict.js';

export function tripRouter(deps: RouteDeps): Router {
  const router = Router();
  // Fresh limiter/store per `createApp()` call — docs/api.md §0: 60 req/min/IP.
  const tripLimiter = createRateLimiter(60_000, 60);

  router.get('/trip', tripLimiter, async (req, res) => {
    const query = parseQuery(tripQuerySchema, req.query);

    if (query.origin === query.dest) {
      throw validationError('origin and dest must be different stations');
    }

    const [originStation, destStation] = await Promise.all([
      getStationDetail(deps.pool, query.origin),
      getStationDetail(deps.pool, query.dest),
    ]);
    if (!originStation) throw notFound(`Unknown station: ${query.origin}`);
    if (!destStation) throw notFound(`Unknown station: ${query.dest}`);
    if (originStation.city_id !== destStation.city_id) {
      throw validationError('origin and dest must be in the same city');
    }

    const now = deps.now();
    // "if in the past -> treated as now" (docs/api.md §3).
    let departAt = query.depart_at ? new Date(query.depart_at) : now;
    if (departAt.getTime() < now.getTime()) departAt = now;

    const rideMinutes =
      query.ride_minutes ??
      rideMinutesDefault(
        { lat: originStation.lat, lon: originStation.lon },
        { lat: destStation.lat, lon: destStation.lon },
      );
    const arriveAt = new Date(departAt.getTime() + rideMinutes * 60_000);

    const [originLookup, destLookup, forecastT0, originAlternatives, destAlternatives] =
      await Promise.all([
        lookup(deps.pool, { stationPk: originStation.id, target: 'bike', at: departAt, now }),
        lookup(deps.pool, { stationPk: destStation.id, target: 'dock', at: arriveAt, now }),
        latestT0ForCity(deps.pool, originStation.city_id),
        alternatives(deps.pool, { stationPk: originStation.id, target: 'bike', at: departAt, now }),
        alternatives(deps.pool, { stationPk: destStation.id, target: 'dock', at: arriveAt, now }),
      ]);

    const originLeg: TripLeg = {
      station: {
        id: originStation.id,
        name: originStation.name,
        lat: originStation.lat,
        lon: originStation.lon,
      },
      lead_minutes: originLookup.leadMinutes,
      kind: originLookup.kind,
      reason: originLookup.reason,
      tier: originLookup.tier,
      p: originLookup.p,
      exp_bikes: originLookup.exp_bikes,
      current: originLookup.current,
      alternatives: originAlternatives,
    };
    const destLeg: TripLeg = {
      station: {
        id: destStation.id,
        name: destStation.name,
        lat: destStation.lat,
        lon: destStation.lon,
      },
      lead_minutes: destLookup.leadMinutes,
      kind: destLookup.kind,
      reason: destLookup.reason,
      tier: destLookup.tier,
      p: destLookup.p,
      exp_bikes: destLookup.exp_bikes,
      current: destLookup.current,
      alternatives: destAlternatives,
    };

    const body: TripResponse = {
      computed_at: now.toISOString(),
      forecast_t0: forecastT0 ? forecastT0.toISOString() : null,
      depart_at: departAt.toISOString(),
      arrive_at: arriveAt.toISOString(),
      ride_minutes: rideMinutes,
      origin: originLeg,
      dest: destLeg,
      verdict: computeVerdict(originLeg, destLeg),
    };
    sendJson(res, 200, tripResponseSchema, body, deps.config, 'no-store');
  });

  return router;
}
