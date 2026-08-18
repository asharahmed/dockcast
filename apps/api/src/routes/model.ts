/**
 * `docs/api.md` §4 — GET /model, GET /model/versions/:id.
 */
import { Router } from 'express';
import { z } from 'zod';
import {
  modelResponseSchema,
  modelVersionDetailResponseSchema,
  type ModelResponse,
  type ModelVersionDetailResponse,
  type ModelVersionSummary,
  type ModelTier,
  type ModelVersionStatus,
  type MetricsVal,
  type Gate,
  type ServingTier,
  type MetricsTier,
  type MetricsTarget,
  type MetricsSlice,
  type MetricName,
  type ModelEvalRow,
} from '@dockcast/shared';
import type { RouteDeps } from '../deps.js';
import { sendJson } from '../lib/respond.js';
import { notFound } from '../middleware/errors.js';
import { parseIntParam, parseQuery } from '../lib/validate.js';
import { getCityBySlug } from '../services/cities.queries.js';
import {
  getActiveModelVersion,
  listRecentModelVersions,
  getModelVersionById,
  getLatestDailyMetrics,
  getModelEval,
  type ModelVersionRow,
} from '../services/model.queries.js';
import {
  getActiveStationCount,
  getCityCollectorLastOkAt,
  getCityPredictorLastRunAt,
  getCollectorUptime7d,
  getDataSince,
  getServingTier,
} from '../services/worker.queries.js';

// Not defined in `@dockcast/shared` (out of this WP's scope to add there) — local query validation only.
const modelQuerySchema = z.object({ city: z.string().min(1) });

function toModelVersionSummary(row: ModelVersionRow): ModelVersionSummary {
  return {
    id: row.id,
    tier: row.tier as ModelTier,
    status: row.status as ModelVersionStatus,
    trained_for_date: row.trained_for_date,
    created_at: row.created_at.toISOString(),
    activated_at: row.activated_at ? row.activated_at.toISOString() : null,
    feature_schema_version: row.feature_schema_version,
    train_window:
      row.train_window_start && row.train_window_end
        ? [row.train_window_start.toISOString(), row.train_window_end.toISOString()]
        : null,
    metrics_val: (row.metrics_val as MetricsVal | null) ?? null,
    gate: (row.gate as Gate | null) ?? null,
  };
}

export function modelRouter(deps: RouteDeps): Router {
  const router = Router();

  router.get('/model', async (req, res) => {
    const query = parseQuery(modelQuerySchema, req.query);
    const city = await getCityBySlug(deps.pool, query.city);
    if (!city) throw notFound(`Unknown city: ${query.city}`);

    const now = deps.now();
    const [
      dataSince,
      nStationsActive,
      collectorLastOkAt,
      uptime7d,
      predictorLastRunAt,
      servingTier,
      activeGbm,
      activeBd,
      metricsRows,
      versionRows,
    ] = await Promise.all([
      getDataSince(deps.pool, city.id),
      getActiveStationCount(deps.pool, city.id),
      getCityCollectorLastOkAt(deps.pool, city.id),
      getCollectorUptime7d(deps.pool, city.id, now),
      getCityPredictorLastRunAt(deps.pool, city.id),
      getServingTier(deps.pool, city.id),
      getActiveModelVersion(deps.pool, city.id, 'gbm'),
      getActiveModelVersion(deps.pool, city.id, 'bd'),
      getLatestDailyMetrics(deps.pool, city.id),
      listRecentModelVersions(deps.pool, city.id, 30),
    ]);

    const body: ModelResponse = {
      city: { slug: city.slug, name: city.name, tz: city.tz },
      data_since: dataSince ? dataSince.toISOString() : null,
      n_stations_active: nStationsActive,
      collector: {
        last_ok_at: collectorLastOkAt ? collectorLastOkAt.toISOString() : null,
        uptime_7d_pct: uptime7d,
      },
      predictor: {
        last_run_at: predictorLastRunAt ? predictorLastRunAt.toISOString() : null,
        serving_tier: servingTier as ServingTier,
      },
      active: {
        gbm: activeGbm ? toModelVersionSummary(activeGbm) : null,
        bd: activeBd ? toModelVersionSummary(activeBd) : null,
      },
      metrics: metricsRows.map((r) => ({
        day: r.day,
        window_days: r.window_days as 1 | 7,
        tier: r.tier as MetricsTier,
        target: r.target as MetricsTarget,
        horizon: r.horizon,
        slice: r.slice as MetricsSlice,
        metric: r.metric as MetricName,
        value: r.value,
        n: r.n,
      })),
      versions: versionRows.map(toModelVersionSummary),
    };
    sendJson(res, 200, modelResponseSchema, body, deps.config, 'public, max-age=300');
  });

  router.get('/model/versions/:id', async (req, res) => {
    const id = parseIntParam(req.params.id);
    if (id === null) throw notFound('Unknown model version');
    const version = await getModelVersionById(deps.pool, id);
    if (!version) throw notFound(`Unknown model version: ${req.params.id}`);

    const evalRows = await getModelEval(deps.pool, id);
    const body: ModelVersionDetailResponse = {
      version: toModelVersionSummary(version),
      eval: evalRows.map((r) => ({
        tier: r.tier as ModelEvalRow['tier'],
        split: r.split as 'val' | 'es',
        target: r.target as MetricsTarget,
        horizon: r.horizon,
        slice: r.slice as MetricsSlice,
        metric: r.metric as MetricName,
        value: r.value,
      })),
    };
    sendJson(res, 200, modelVersionDetailResponseSchema, body, deps.config, 'public, max-age=300');
  });

  return router;
}
