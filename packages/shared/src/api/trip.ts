/**
 * `docs/api.md` §3 — GET /trip.
 */
import { z } from 'zod';
import { legKindSchema, verdictSchema } from '../forecast.js';
import { stationRefSchema } from './stations.js';

/** `GET /trip?origin=&dest=&depart_at=&ride_minutes=` query. */
export const tripQuerySchema = z.object({
  origin: z.coerce.number().int(),
  dest: z.coerce.number().int(),
  depart_at: z.string().datetime({ offset: true }).optional(),
  ride_minutes: z.coerce.number().int().min(1).max(180).optional(),
});
export type TripQuery = z.infer<typeof tripQuerySchema>;

export const tripCurrentSchema = z.object({
  bikes: z.number().int(),
  docks: z.number().int(),
  cap_eff: z.number().int(),
  as_of: z.string().datetime({ offset: true }),
  is_fresh: z.boolean(),
});
export type TripCurrent = z.infer<typeof tripCurrentSchema>;

export const tripAlternativeSchema = z.object({
  station: stationRefSchema,
  distance_m: z.number(),
  walk_minutes: z.number().int(),
  p: z.number().nullable(),
  exp_bikes: z.number().nullable(),
});
export type TripAlternative = z.infer<typeof tripAlternativeSchema>;

export const tripLegSchema = z.object({
  station: stationRefSchema,
  lead_minutes: z.number(),
  kind: legKindSchema,
  reason: z.string().nullable(),
  tier: z.string().nullable(),
  p: z.number().nullable(),
  exp_bikes: z.number().nullable(),
  current: tripCurrentSchema.nullable(),
  alternatives: z.array(tripAlternativeSchema),
});
export type TripLeg = z.infer<typeof tripLegSchema>;

export const tripResponseSchema = z.object({
  computed_at: z.string().datetime({ offset: true }),
  forecast_t0: z.string().datetime({ offset: true }).nullable(),
  depart_at: z.string().datetime({ offset: true }),
  arrive_at: z.string().datetime({ offset: true }),
  ride_minutes: z.number().int().min(1).max(180),
  origin: tripLegSchema,
  dest: tripLegSchema,
  verdict: verdictSchema,
});
export type TripResponse = z.infer<typeof tripResponseSchema>;
