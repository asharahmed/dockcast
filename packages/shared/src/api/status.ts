/**
 * `docs/api.md` §1 — GET /status. Public, so the schema is an allowlist: every object is
 * `.strict()` and every leaf is a coarse enum, a small integer, a percentage, or a `YYYY-MM-DD`
 * date. No timestamps with a time of day, no names, versions, error text or resource numbers.
 * See `docs/api.md` "Public status page threat model".
 */
import { z } from 'zod';

export const statusStateSchema = z.enum(['operational', 'degraded', 'down']);
export type StatusState = z.infer<typeof statusStateSchema>;

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** The only trainer stages ever shown; internal phases are mapped onto these server-side. */
export const STATUS_STAGES = ['preparing data', 'training', 'evaluating', 'publishing'] as const;
export const statusStageSchema = z.enum(STATUS_STAGES);
export type StatusStage = z.infer<typeof statusStageSchema>;

/** One day of one component: `ok` (>= 99% of the day's minutes up), `down`, or `none` (no data). */
export const statusDayCellSchema = z.enum(['ok', 'down', 'none']);
export type StatusDayCell = z.infer<typeof statusDayCellSchema>;

const freshness = z
  .object({
    state: statusStateSchema,
    /** Whole minutes since the last successful update; `null` if there has never been one. */
    updated_min_ago: z.number().int().min(0).nullable(),
  })
  .strict();

export const statusRunningSchema = z
  .object({
    /** 0..97, whole numbers; `null` when there is no earlier successful run to compare against. */
    percent: z.number().int().min(0).max(97).nullable(),
    stage: statusStageSchema,
    /** Whole minutes remaining, `null` when `percent` is. */
    eta_min: z.number().int().min(0).nullable(),
  })
  .strict();

export const statusModelUpdateSchema = z
  .object({
    date: dateOnly,
    ok: z.boolean(),
    /** Whole minutes; `null` if the run never finished. */
    duration_min: z.number().int().min(0).nullable(),
  })
  .strict();
export type StatusModelUpdate = z.infer<typeof statusModelUpdateSchema>;

const days14 = z.array(statusDayCellSchema).length(14);

export const statusResponseSchema = z
  .object({
    overall: statusStateSchema,
    website: z
      .object({ state: statusStateSchema, latency: z.enum(['fast', 'slow']).nullable() })
      .strict(),
    stations: freshness,
    forecasts: freshness,
    models: z
      .object({
        state: statusStateSchema,
        /** UTC date of the last successful update. */
        last_update_date: dateOnly.nullable(),
        running: statusRunningSchema.nullable(),
      })
      .strict(),
    database: z.object({ state: z.enum(['operational', 'down']) }).strict(),
    release: z
      .object({
        /** Coarse age of the running release: minutes under 2 h, hours under 2 d, else days. */
        deployed_ago: z
          .object({ value: z.number().int().min(0), unit: z.enum(['minutes', 'hours', 'days']) })
          .strict(),
        uptime_7d: z.number().min(0).max(100).nullable(),
        uptime_30d: z.number().min(0).max(100).nullable(),
      })
      .strict(),
    history: z
      .object({
        /** The 14 UTC dates covered, oldest first; every component array lines up with it. */
        days: z.array(dateOnly).length(14),
        website: days14,
        stations: days14,
        forecasts: days14,
        database: days14,
      })
      .strict(),
    /** One row per UTC date, newest first, at most 14. */
    model_updates: z.array(statusModelUpdateSchema).max(14),
  })
  .strict();
export type StatusResponse = z.infer<typeof statusResponseSchema>;
