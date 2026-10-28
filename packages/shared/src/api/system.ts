/**
 * `docs/api.md` §1 — GET /health.
 */
import { z } from 'zod';

export const healthResponseSchema = z.object({
  ok: z.boolean(),
  db: z.boolean(),
  collector_last_ok_at: z.string().datetime({ offset: true }).nullable(),
  predictor_last_run_at: z.string().datetime({ offset: true }).nullable(),
});
export type HealthResponse = z.infer<typeof healthResponseSchema>;
