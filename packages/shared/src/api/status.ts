/**
 * `docs/api.md` §1 — GET /status. Public, so every field is a number, timestamp, boolean, enum or
 * a phase name from the fixed {@link TRAIN_PHASES} allowlist; never error text or environment.
 */
import { z } from 'zod';
import { TRAIN_PHASES } from '../constants.js';

const ts = z.string().datetime({ offset: true });

export const trainPhaseNameSchema = z.enum(TRAIN_PHASES);

export const statusPhaseSchema = z.object({
  phase: trainPhaseNameSchema,
  ts,
  peak_rss_mib: z.number().nullable(),
});
export type StatusPhase = z.infer<typeof statusPhaseSchema>;

export const statusTrainCurrentSchema = z.object({
  started_at: ts,
  /** The phase being worked on now (the one after the last finished marker). */
  phase: trainPhaseNameSchema.nullable(),
  /** Finished phases, oldest first. */
  phases: z.array(statusPhaseSchema),
  attempt: z.number().int().nullable(),
  max_attempts: z.number().int().nullable(),
  elapsed_s: z.number().int(),
  /** 0..97 while running; `null` when there is no successful reference run to compare against. */
  percent: z.number().min(0).max(100).nullable(),
  eta_s: z.number().int().nullable(),
  state: z.enum(['running', 'stalled']),
});
export type StatusTrainCurrent = z.infer<typeof statusTrainCurrentSchema>;

export const statusTrainRunSchema = z.object({
  started_at: ts,
  duration_s: z.number().int().nullable(),
  /** `null` while unfinished, or when the process died without finishing (stalled). */
  ok: z.boolean().nullable(),
  attempt: z.number().int().nullable(),
  peak_rss_mib: z.number().nullable(),
  gate_passed: z.boolean().nullable(),
  val_brier_bike: z.number().nullable(),
  val_brier_dock: z.number().nullable(),
  gbm_status: z
    .enum(['active', 'shadow', 'rejected', 'superseded', 'insufficient_data', 'failed'])
    .nullable(),
});
export type StatusTrainRun = z.infer<typeof statusTrainRunSchema>;

export const statusServiceSchema = z.object({
  /** Age in seconds of the last finished run / heartbeat; `null` if there is none. */
  age_s: z.number().int().nullable(),
  ok: z.boolean().nullable(),
});

export const statusResponseSchema = z.object({
  generated_at: ts,
  train: z.object({
    current: statusTrainCurrentSchema.nullable(),
    history: z.array(statusTrainRunSchema),
    /** Seconds since the last finished train run, `null` if none. */
    last_finished_age_s: z.number().int().nullable(),
  }),
  services: z.object({
    predict: statusServiceSchema,
    collector: statusServiceSchema,
    db: z.object({ ok: z.boolean() }),
    api: z.object({ version: z.string(), git_sha: z.string().nullable() }),
  }),
});
export type StatusResponse = z.infer<typeof statusResponseSchema>;
