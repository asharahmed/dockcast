/**
 * `docs/api.md` §4 — GET /model, GET /model/versions/:id.
 *
 * Enum domains not spelled out inline in `api.md` (`ServingTier`, `ModelTier`,
 * `ModelVersionStatus`, `MetricsTier`, `MetricsTarget`, `MetricsSlice`,
 * `MetricName`) are taken from the authoritative sources named alongside each
 * one: `db/migrations/0001_init.sql` CHECK constraints and comments, and
 * `docs/ml-spec.md` §5.
 */
import { z } from 'zod';
import { HORIZONS } from '../constants.js';

/**
 * The tier actually serving `forecasts_latest` for a station/horizon.
 * `db/migrations/0001_init.sql` (`forecasts_latest.tier`); `docs/api.md` §4
 * (`ModelResponse.predictor.serving_tier`).
 */
export const servingTierSchema = z.enum(['gbm', 'bd_cal', 'bd_raw', 'none']);
export type ServingTier = z.infer<typeof servingTierSchema>;

/** `db/migrations/0001_init.sql` (`model_versions.tier`). */
export const modelTierSchema = z.enum(['bd', 'gbm']);
export type ModelTier = z.infer<typeof modelTierSchema>;

/** `db/migrations/0001_init.sql` (`model_versions.status`). */
export const modelVersionStatusSchema = z.enum([
  'active',
  'shadow',
  'rejected',
  'superseded',
  'insufficient_data',
  'failed',
]);
export type ModelVersionStatus = z.infer<typeof modelVersionStatusSchema>;

/**
 * Tier label used in online-metrics rows (`forecast_history`/`model_metrics_daily`),
 * distinct from {@link ServingTier}: it includes `'persistence'` and splits
 * `'gbm'` into `'gbm_active'`/`'gbm_shadow'`. `docs/ml-spec.md` §5.4.
 */
export const metricsTierSchema = z.enum([
  'persistence',
  'bd_raw',
  'bd_cal',
  'gbm_active',
  'gbm_shadow',
]);
export type MetricsTier = z.infer<typeof metricsTierSchema>;

/**
 * The online-metrics tier that scores what a {@link ServingTier} serves, or
 * `null` when nothing is served. Used by the public `/model` view, which only
 * shows the serving tier and the persistence baseline (`docs/api.md` §4).
 */
export function metricsTierForServing(tier: ServingTier): MetricsTier | null {
  switch (tier) {
    case 'gbm':
      return 'gbm_active';
    case 'bd_cal':
      return 'bd_cal';
    case 'bd_raw':
      return 'bd_raw';
    case 'none':
      return null;
  }
}

/** `docs/ml-spec.md` §3 / §5.2 (`model_eval.target`, `model_metrics_daily.target`). */
export const metricsTargetSchema = z.enum(['bike', 'dock', 'cnt']);
export type MetricsTarget = z.infer<typeof metricsTargetSchema>;

/** `docs/ml-spec.md` §5.2. */
export const metricsSliceSchema = z.enum(['all', 'at_risk']);
export type MetricsSlice = z.infer<typeof metricsSliceSchema>;

function reliabilityMetricNames(): string[] {
  const names: string[] = [];
  for (let bin = 0; bin <= 9; bin++) {
    names.push(`rel_bin_${bin}_mean_pred`, `rel_bin_${bin}_frac_pos`, `rel_bin_${bin}_n`);
  }
  return names;
}

/**
 * Closed set of metric names: the base metrics plus the 10 reliability bins'
 * three columns each. `docs/api.md` §4, `docs/ml-spec.md` §5.2/§5.3.
 */
const METRIC_NAMES: [string, ...string[]] = [
  'brier',
  'logloss',
  'auc',
  'ece',
  'mae',
  'rmse',
  'n',
  ...reliabilityMetricNames(),
];
export const metricNameSchema = z.enum(METRIC_NAMES);
export type MetricName = z.infer<typeof metricNameSchema>;

/** `horizon = 0` (pooled) or one of {@link HORIZONS}. */
export const horizonOrPooledSchema = z
  .number()
  .refine((h): h is number => h === 0 || (HORIZONS as readonly number[]).includes(h), {
    message: 'horizon must be 0 (pooled) or one of HORIZONS',
  });

export const modelMetricRowSchema = z.object({
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  window_days: z.union([z.literal(1), z.literal(7)]),
  tier: metricsTierSchema,
  target: metricsTargetSchema,
  horizon: horizonOrPooledSchema,
  slice: metricsSliceSchema,
  metric: metricNameSchema,
  value: z.number().nullable(),
  n: z.number().int().nonnegative(),
});
export type ModelMetricRow = z.infer<typeof modelMetricRowSchema>;

const bikeDockNumberSchema = z.object({ bike: z.number(), dock: z.number() });
const bikeDockNullableNumberSchema = z.object({
  bike: z.number().nullable(),
  dock: z.number().nullable(),
});

export const metricsValSchema = z.object({
  n_val: z.number().int().nonnegative(),
  brier: bikeDockNumberSchema,
  logloss: bikeDockNumberSchema,
  auc: bikeDockNullableNumberSchema,
  ece: bikeDockNumberSchema,
  mae: z.number(),
  rmse: z.number(),
  brier_at_risk: bikeDockNumberSchema,
  ref: z.object({
    tier: z.union([z.literal('bd_cal'), z.literal('bd_raw'), z.null()]),
    brier: bikeDockNumberSchema.nullable(),
    mae: z.number().nullable(),
  }),
});
export type MetricsVal = z.infer<typeof metricsValSchema>;

export const gateCheckSchema = z.object({
  name: z.string(),
  value: z.number().nullable(),
  threshold: z.number().nullable(),
  ok: z.boolean(),
});
export type GateCheck = z.infer<typeof gateCheckSchema>;

export const gateSchema = z.object({
  passed: z.boolean(),
  checks: z.array(gateCheckSchema),
});
export type Gate = z.infer<typeof gateSchema>;

export const modelVersionSummarySchema = z.object({
  id: z.number().int(),
  tier: modelTierSchema,
  status: modelVersionStatusSchema,
  trained_for_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  created_at: z.string().datetime({ offset: true }),
  activated_at: z.string().datetime({ offset: true }).nullable(),
  feature_schema_version: z.number().int(),
  train_window: z
    .tuple([z.string().datetime({ offset: true }), z.string().datetime({ offset: true })])
    .nullable(),
  metrics_val: metricsValSchema.nullable(),
  gate: gateSchema.nullable(),
});
export type ModelVersionSummary = z.infer<typeof modelVersionSummarySchema>;

export const modelResponseSchema = z.object({
  city: z.object({ slug: z.string(), name: z.string(), tz: z.string() }),
  data_since: z.string().datetime({ offset: true }).nullable(),
  n_stations_active: z.number().int().nonnegative(),
  collector: z.object({
    last_ok_at: z.string().datetime({ offset: true }).nullable(),
    uptime_7d_pct: z.number().nullable(),
  }),
  predictor: z.object({
    last_run_at: z.string().datetime({ offset: true }).nullable(),
    serving_tier: servingTierSchema,
  }),
  active: z.object({
    gbm: modelVersionSummarySchema.nullable(),
    bd: modelVersionSummarySchema.nullable(),
  }),
  metrics: z.array(modelMetricRowSchema),
  versions: z.array(modelVersionSummarySchema),
  /**
   * Which shape this response is (`docs/api.md` §4): `is_admin: false` means the
   * public view (serving tier + persistence metrics, no `versions`, no gate or
   * validation detail on `active`); `true` means the full operator view.
   */
  viewer: z.object({ is_admin: z.boolean() }),
});
export type ModelResponse = z.infer<typeof modelResponseSchema>;

export const modelEvalRowSchema = z.object({
  tier: metricsTierSchema.or(z.literal('gbm')),
  split: z.enum(['val', 'es']),
  target: metricsTargetSchema,
  horizon: horizonOrPooledSchema,
  slice: metricsSliceSchema,
  metric: metricNameSchema,
  value: z.number().nullable(),
});
export type ModelEvalRow = z.infer<typeof modelEvalRowSchema>;

export const modelVersionDetailResponseSchema = z.object({
  version: modelVersionSummarySchema,
  eval: z.array(modelEvalRowSchema),
});
export type ModelVersionDetailResponse = z.infer<typeof modelVersionDetailResponseSchema>;
