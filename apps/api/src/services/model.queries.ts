/**
 * `model_versions`, `model_eval`, `model_metrics_daily`. `docs/api.md` §4.
 */
import type { Pool } from '@dockcast/db';
import { many, maybeOne } from '@dockcast/db';

export interface ModelVersionRow {
  id: number;
  tier: string;
  status: string;
  trained_for_date: string;
  created_at: Date;
  activated_at: Date | null;
  feature_schema_version: number;
  train_window_start: Date | null;
  train_window_end: Date | null;
  metrics_val: unknown;
  gate: unknown;
}

// `artifact` (bytea) is deliberately excluded — `docs/plan.md` WP-7 "versions: last 30 without artifact".
const VERSION_COLUMNS = `
  id, tier, status, trained_for_date::text AS trained_for_date, created_at, activated_at,
  feature_schema_version, lower(train_window) AS train_window_start, upper(train_window) AS train_window_end,
  metrics_val, gate
`;

export async function getActiveModelVersion(
  pool: Pool,
  cityId: number,
  tier: 'gbm' | 'bd',
): Promise<ModelVersionRow | null> {
  return maybeOne<ModelVersionRow>(
    pool,
    `SELECT ${VERSION_COLUMNS} FROM model_versions
     WHERE city_id = $1 AND tier = $2 AND status = 'active'
     ORDER BY created_at DESC LIMIT 1`,
    [cityId, tier],
  );
}

export async function listRecentModelVersions(
  pool: Pool,
  cityId: number,
  limit: number,
): Promise<ModelVersionRow[]> {
  return many<ModelVersionRow>(
    pool,
    `SELECT ${VERSION_COLUMNS} FROM model_versions WHERE city_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [cityId, limit],
  );
}

export async function getModelVersionById(pool: Pool, id: number): Promise<ModelVersionRow | null> {
  return maybeOne<ModelVersionRow>(
    pool,
    `SELECT ${VERSION_COLUMNS} FROM model_versions WHERE id = $1`,
    [id],
  );
}

export interface ModelMetricRow {
  day: string;
  window_days: number;
  tier: string;
  target: string;
  horizon: number;
  slice: string;
  metric: string;
  value: number | null;
  n: number;
}

/** All rows for the latest `day` present for this city (`[]` if none). */
export async function getLatestDailyMetrics(pool: Pool, cityId: number): Promise<ModelMetricRow[]> {
  return many<ModelMetricRow>(
    pool,
    `SELECT day::text AS day, window_days, tier, target, horizon, slice, metric, value, n
     FROM model_metrics_daily
     WHERE city_id = $1 AND day = (SELECT max(day) FROM model_metrics_daily WHERE city_id = $1)
     ORDER BY window_days, tier, target, horizon, slice, metric`,
    [cityId],
  );
}

export interface ModelEvalRow {
  split: string;
  target: string;
  horizon: number;
  slice: string;
  metric: string;
  value: number | null;
}

export async function getModelEval(pool: Pool, modelVersionId: number): Promise<ModelEvalRow[]> {
  return many<ModelEvalRow>(
    pool,
    `SELECT split, target, horizon, slice, metric, value
     FROM model_eval WHERE model_version_id = $1
     ORDER BY split, target, horizon, slice, metric`,
    [modelVersionId],
  );
}
