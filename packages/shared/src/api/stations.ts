/**
 * `docs/api.md` §2 — GET /cities/:slug/stations, GET /cities/:slug/map,
 * GET /stations/:id, GET /stations/:id/history.
 */
import { z } from 'zod';
import { servingTierSchema } from './model.js';

/**
 * Minimal station reference `{ id, name, lat, lon }`. `docs/api.md` §6 names
 * this `StationRef`; it's defined here (not in `commutes.ts`) because
 * `trip.ts` needs the identical shape too and `stations.ts` is the more
 * foundational module.
 */
export const stationRefSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  lat: z.number(),
  lon: z.number(),
});
export type StationRef = z.infer<typeof stationRefSchema>;

export const stationListItemSchema = z.object({
  id: z.number().int(),
  station_id: z.string(),
  name: z.string(),
  lat: z.number(),
  lon: z.number(),
  capacity: z.number().int().nullable(),
});
export type StationListItem = z.infer<typeof stationListItemSchema>;

export const stationListResponseSchema = z.object({
  stations: z.array(stationListItemSchema),
});
export type StationListResponse = z.infer<typeof stationListResponseSchema>;

const mapForecastEntrySchema = z.union([z.null(), z.tuple([z.number(), z.number(), z.number()])]);

export const mapStationSchema = z.object({
  id: z.number().int(),
  b: z.number(),
  d: z.number(),
  c: z.number(),
  fresh: z.boolean(),
  f: z.array(mapForecastEntrySchema),
});
export type MapStation = z.infer<typeof mapStationSchema>;

export const mapResponseSchema = z.object({
  t0: z.string().datetime({ offset: true }).nullable(),
  as_of: z.string().datetime({ offset: true }),
  horizons: z.array(z.number()),
  stations: z.array(mapStationSchema),
});
export type MapResponse = z.infer<typeof mapResponseSchema>;

export const stationDetailStationSchema = z.object({
  id: z.number().int(),
  station_id: z.string(),
  name: z.string(),
  lat: z.number(),
  lon: z.number(),
  capacity: z.number().int().nullable(),
  city: z.object({ slug: z.string(), name: z.string(), tz: z.string() }),
});

export const stationCurrentSchema = z.object({
  bikes: z.number().int(),
  docks: z.number().int(),
  ebikes: z.number().int().nullable(),
  cap_eff: z.number().int(),
  is_fresh: z.boolean(),
  as_of: z.string().datetime({ offset: true }),
  last_reported: z.string().datetime({ offset: true }),
});
export type StationCurrent = z.infer<typeof stationCurrentSchema>;

export const stationForecastRowSchema = z.object({
  horizon: z.number(),
  valid_at: z.string().datetime({ offset: true }),
  p_bike: z.number().nullable(),
  p_dock: z.number().nullable(),
  exp_bikes: z.number().nullable(),
  q10: z.number().nullable(),
  q90: z.number().nullable(),
  tier: servingTierSchema,
  reason: z.string().nullable(),
});
export type StationForecastRow = z.infer<typeof stationForecastRowSchema>;

export const stationHistoryPointSchema = z.object({
  ts: z.string().datetime({ offset: true }),
  bikes: z.number().int(),
  docks: z.number().int(),
});
export type StationHistoryPoint = z.infer<typeof stationHistoryPointSchema>;

export const stationTypicalRowSchema = z.object({
  bucket: z.number().int().min(0).max(95),
  mean_fill: z.number().nullable(),
  p_bike: z.number().nullable(),
  p_dock: z.number().nullable(),
});
export type StationTypicalRow = z.infer<typeof stationTypicalRowSchema>;

export const stationNeighborSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  distance_m: z.number(),
  bikes: z.number().int().nullable(),
  docks: z.number().int().nullable(),
});
export type StationNeighbor = z.infer<typeof stationNeighborSchema>;

export const stationDetailResponseSchema = z.object({
  station: stationDetailStationSchema,
  current: stationCurrentSchema.nullable(),
  forecasts: z.array(stationForecastRowSchema),
  history: z.array(stationHistoryPointSchema),
  typical: z.array(stationTypicalRowSchema),
  neighbors: z.array(stationNeighborSchema),
});
export type StationDetailResponse = z.infer<typeof stationDetailResponseSchema>;

/** `GET /stations/:id/history?hours=<n>` query. `hours ∈ [1, 168]`, default 24. */
export const stationHistoryQuerySchema = z.object({
  hours: z.coerce.number().int().min(1).max(168).default(24),
});
export type StationHistoryQuery = z.infer<typeof stationHistoryQuerySchema>;

export const stationHistoryResponseSchema = z.object({
  points: z.array(stationHistoryPointSchema),
});
export type StationHistoryResponse = z.infer<typeof stationHistoryResponseSchema>;
