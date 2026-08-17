/**
 * `docs/api.md` §6 — /commutes (auth required).
 */
import { z } from 'zod';
import { legKindSchema, verdictSchema } from '../forecast.js';
import { stationRefSchema } from './stations.js';

const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** `0=Mon..6=Sun`, 1-7 unique values. `docs/api.md` §6. */
export const daysOfWeekSchema = z
  .array(z.number().int().min(0).max(6))
  .min(1)
  .max(7)
  .refine((days) => new Set(days).size === days.length, {
    message: 'days_of_week must not contain duplicates',
  });
export type DaysOfWeek = z.infer<typeof daysOfWeekSchema>;

export const commuteSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(60),
  city: z.object({ slug: z.string(), tz: z.string() }),
  origin: stationRefSchema,
  dest: stationRefSchema,
  depart_local_time: z.string().regex(HHMM_RE),
  ride_minutes: z.number().int().min(1).max(180),
  days_of_week: daysOfWeekSchema,
  alert_enabled: z.boolean(),
  alert_lead_minutes: z.number().int().min(5).max(120),
  threshold: z.number().min(0.05).max(0.95),
  created_at: z.string().datetime({ offset: true }),
  updated_at: z.string().datetime({ offset: true }),
});
export type Commute = z.infer<typeof commuteSchema>;

export const commuteOutlookLegSchema = z.object({
  kind: legKindSchema,
  p: z.number().nullable(),
});
export type CommuteOutlookLeg = z.infer<typeof commuteOutlookLegSchema>;

export const commuteOutlookSchema = z.object({
  next_depart_at: z.string().datetime({ offset: true }).nullable(),
  next_arrive_at: z.string().datetime({ offset: true }).nullable(),
  origin: commuteOutlookLegSchema,
  dest: commuteOutlookLegSchema,
  verdict: verdictSchema,
});
export type CommuteOutlook = z.infer<typeof commuteOutlookSchema>;

/** `GET /commutes` list item: a `Commute` plus its computed `outlook`. */
export const commuteWithOutlookSchema = commuteSchema.extend({ outlook: commuteOutlookSchema });
export type CommuteWithOutlook = z.infer<typeof commuteWithOutlookSchema>;

/** `GET /commutes` response (unnamed in `api.md`; named here for the schema barrel). */
export const commuteListResponseSchema = z.object({
  commutes: z.array(commuteWithOutlookSchema),
});
export type CommuteListResponse = z.infer<typeof commuteListResponseSchema>;

export const commuteCreateRequestSchema = z.object({
  name: z.string().min(1).max(60),
  origin_station_id: z.number().int(),
  dest_station_id: z.number().int(),
  depart_local_time: z.string().regex(HHMM_RE),
  ride_minutes: z.number().int().min(1).max(180).optional(),
  days_of_week: daysOfWeekSchema,
  alert_enabled: z.boolean().optional().default(true),
  alert_lead_minutes: z.number().int().min(5).max(120).optional().default(20),
  threshold: z.number().min(0.05).max(0.95).optional().default(0.7),
});
export type CommuteCreateRequest = z.infer<typeof commuteCreateRequestSchema>;

/** `PATCH /commutes/:id` body: every `CommuteCreateRequest` field, optional. */
export const commuteUpdateRequestSchema = z.object({
  name: z.string().min(1).max(60).optional(),
  origin_station_id: z.number().int().optional(),
  dest_station_id: z.number().int().optional(),
  depart_local_time: z.string().regex(HHMM_RE).optional(),
  ride_minutes: z.number().int().min(1).max(180).optional(),
  days_of_week: daysOfWeekSchema.optional(),
  alert_enabled: z.boolean().optional(),
  alert_lead_minutes: z.number().int().min(5).max(120).optional(),
  threshold: z.number().min(0.05).max(0.95).optional(),
});
export type CommuteUpdateRequest = z.infer<typeof commuteUpdateRequestSchema>;

/** `POST /commutes` → 201 response (unnamed in `api.md`). */
export const commuteCreateResponseSchema = z.object({ commute: commuteSchema });
export type CommuteCreateResponse = z.infer<typeof commuteCreateResponseSchema>;

/** `PATCH /commutes/:id` → 200 response (unnamed in `api.md`). */
export const commuteUpdateResponseSchema = z.object({ commute: commuteSchema });
export type CommuteUpdateResponse = z.infer<typeof commuteUpdateResponseSchema>;
