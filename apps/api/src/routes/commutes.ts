/**
 * `docs/api.md` §6 — /commutes (auth required).
 */
import { Router } from 'express';
import { z } from 'zod';
import {
  commuteCreateRequestSchema,
  commuteUpdateRequestSchema,
  commuteCreateResponseSchema,
  commuteUpdateResponseSchema,
  commuteListResponseSchema,
  rideMinutesDefault,
  nextOccurrence,
  type Commute,
  type CommuteOutlook,
  type CommuteWithOutlook,
} from '@dockcast/shared';
import type { Pool } from '@dockcast/db';
import type { RouteDeps } from '../deps.js';
import { sendJson } from '../lib/respond.js';
import { notFound, forbidden, validationError } from '../middleware/errors.js';
import { parseBody } from '../lib/validate.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { getStationDetail, type StationDetailRow } from '../services/stations.queries.js';
import {
  countCommutesForUser,
  listCommutesForUser,
  getCommuteById,
  createCommute,
  updateCommute,
  deleteCommute,
  type CommuteRow,
  type CommuteWriteFields,
} from '../services/commutes.queries.js';
import { lookup } from '../forecast/lookup.js';
import { computeVerdict } from '../forecast/verdict.js';

const MAX_COMMUTES_PER_USER = 20;

const idParamSchema = z.string().uuid();

function requireCommuteId(id: string | string[] | undefined): string {
  const result = idParamSchema.safeParse(id);
  if (!result.success) throw notFound('Unknown commute');
  return result.data;
}

function toCommuteDto(row: CommuteRow): Commute {
  return {
    id: row.id,
    name: row.name,
    city: { slug: row.city_slug, tz: row.city_tz },
    origin: { id: row.origin_id, name: row.origin_name, lat: row.origin_lat, lon: row.origin_lon },
    dest: { id: row.dest_id, name: row.dest_name, lat: row.dest_lat, lon: row.dest_lon },
    depart_local_time: row.depart_local_time,
    ride_minutes: row.ride_minutes,
    days_of_week: row.days_of_week,
    alert_enabled: row.alert_enabled,
    alert_lead_minutes: row.alert_lead_minutes,
    threshold: row.threshold,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

/** `docs/api.md` §6: "`city` derived from stations (must match; else 400)". */
async function resolveStations(
  pool: Pool,
  originId: number,
  destId: number,
): Promise<{ cityId: number; origin: StationDetailRow; dest: StationDetailRow }> {
  if (originId === destId) {
    throw validationError('origin_station_id and dest_station_id must be different stations');
  }
  const [origin, dest] = await Promise.all([
    getStationDetail(pool, originId),
    getStationDetail(pool, destId),
  ]);
  if (!origin) throw notFound(`Unknown origin_station_id: ${originId}`);
  if (!dest) throw notFound(`Unknown dest_station_id: ${destId}`);
  if (origin.city_id !== dest.city_id) {
    throw validationError('origin_station_id and dest_station_id must be in the same city');
  }
  return { cityId: origin.city_id, origin, dest };
}

/**
 * `docs/api.md` §6 `CommuteOutlook`: `next_depart_at` via `nextOccurrence`,
 * `next_arrive_at = next_depart_at + ride_minutes`, legs via §0.1 `lookup`.
 */
async function computeOutlook(pool: Pool, row: CommuteRow, now: Date): Promise<CommuteOutlook> {
  const nextDepartAt = nextOccurrence(now, row.city_tz, row.depart_local_time, row.days_of_week);
  if (!nextDepartAt) {
    return {
      next_depart_at: null,
      next_arrive_at: null,
      origin: { kind: 'unavailable', p: null },
      dest: { kind: 'unavailable', p: null },
      verdict: 'unknown',
    };
  }
  const nextArriveAt = new Date(nextDepartAt.getTime() + row.ride_minutes * 60_000);
  const [originLookup, destLookup] = await Promise.all([
    lookup(pool, { stationPk: row.origin_id, target: 'bike', at: nextDepartAt, now }),
    lookup(pool, { stationPk: row.dest_id, target: 'dock', at: nextArriveAt, now }),
  ]);
  return {
    next_depart_at: nextDepartAt.toISOString(),
    next_arrive_at: nextArriveAt.toISOString(),
    origin: { kind: originLookup.kind, p: originLookup.p },
    dest: { kind: destLookup.kind, p: destLookup.p },
    verdict: computeVerdict(originLookup, destLookup),
  };
}

export function commutesRouter(deps: RouteDeps): Router {
  const router = Router();

  router.get('/commutes', requireAuth, async (req, res) => {
    const userId = req.session.userId as string;
    const rows = await listCommutesForUser(deps.pool, userId);
    const now = deps.now();
    const commutes: CommuteWithOutlook[] = await Promise.all(
      rows.map(async (row) => ({ ...toCommuteDto(row), outlook: await computeOutlook(deps.pool, row, now) })),
    );
    sendJson(res, 200, commuteListResponseSchema, { commutes }, deps.config, 'no-store');
  });

  router.post('/commutes', requireAuth, async (req, res) => {
    const userId = req.session.userId as string;
    const body = parseBody(commuteCreateRequestSchema, req.body);

    const existingCount = await countCommutesForUser(deps.pool, userId);
    if (existingCount >= MAX_COMMUTES_PER_USER) {
      throw validationError(`Maximum of ${MAX_COMMUTES_PER_USER} commutes per user`);
    }

    const { cityId, origin, dest } = await resolveStations(
      deps.pool,
      body.origin_station_id,
      body.dest_station_id,
    );

    const fields: CommuteWriteFields = {
      name: body.name,
      cityId,
      originStationPk: origin.id,
      destStationPk: dest.id,
      departLocalTime: body.depart_local_time,
      rideMinutes:
        body.ride_minutes ??
        rideMinutesDefault({ lat: origin.lat, lon: origin.lon }, { lat: dest.lat, lon: dest.lon }),
      daysOfWeek: body.days_of_week,
      alertEnabled: body.alert_enabled,
      alertLeadMinutes: body.alert_lead_minutes,
      threshold: body.threshold,
    };
    const created = await createCommute(deps.pool, userId, fields);
    sendJson(
      res,
      201,
      commuteCreateResponseSchema,
      { commute: toCommuteDto(created) },
      deps.config,
      'no-store',
    );
  });

  router.patch('/commutes/:id', requireAuth, async (req, res) => {
    const id = requireCommuteId(req.params.id);
    const existing = await getCommuteById(deps.pool, id);
    if (!existing) throw notFound(`Unknown commute: ${id}`);
    if (existing.user_id !== (req.session.userId as string)) {
      throw forbidden('Commute belongs to another user');
    }

    const body = parseBody(commuteUpdateRequestSchema, req.body);

    const originId = body.origin_station_id ?? existing.origin_id;
    const destId = body.dest_station_id ?? existing.dest_id;
    let cityId = existing.city_id;
    if (body.origin_station_id !== undefined || body.dest_station_id !== undefined) {
      const resolved = await resolveStations(deps.pool, originId, destId);
      cityId = resolved.cityId;
    }

    const fields: CommuteWriteFields = {
      name: body.name ?? existing.name,
      cityId,
      originStationPk: originId,
      destStationPk: destId,
      departLocalTime: body.depart_local_time ?? existing.depart_local_time,
      rideMinutes: body.ride_minutes ?? existing.ride_minutes,
      daysOfWeek: body.days_of_week ?? existing.days_of_week,
      alertEnabled: body.alert_enabled ?? existing.alert_enabled,
      alertLeadMinutes: body.alert_lead_minutes ?? existing.alert_lead_minutes,
      threshold: body.threshold ?? existing.threshold,
    };
    const updated = await updateCommute(deps.pool, id, fields);
    sendJson(
      res,
      200,
      commuteUpdateResponseSchema,
      { commute: toCommuteDto(updated) },
      deps.config,
      'no-store',
    );
  });

  router.delete('/commutes/:id', requireAuth, async (req, res) => {
    const id = requireCommuteId(req.params.id);
    const existing = await getCommuteById(deps.pool, id);
    if (!existing) throw notFound(`Unknown commute: ${id}`);
    if (existing.user_id !== (req.session.userId as string)) {
      throw forbidden('Commute belongs to another user');
    }
    await deleteCommute(deps.pool, id);
    res.status(204).end();
  });

  return router;
}
