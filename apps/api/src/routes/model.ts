/**
 * `docs/api.md` §4 — GET /model, GET /model/versions/:id.
 *
 * Two shapes of `/model`, decided server-side (`lib/viewer.ts`): the operator
 * view for signed-in `ADMIN_EMAILS` (everything, `private, no-store`) and the
 * public view for everyone else (serving tier + persistence metrics only, no
 * version history, no gate/validation detail on the active models, cacheable).
 * `/model/versions/:id` is operator-only and 404s otherwise.
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
  metricsTierForServing,
} from '@dockcast/shared';
import type { RouteDeps } from '../deps.js';
import { sendJson } from '../lib/respond.js';
import { notFound } from '../middleware/errors.js';
import { isAdminRequest } from '../lib/viewer.js';
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
    const admin = await isAdminRequest(deps, req);
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

    // Public view: only the tier that is actually serving, plus the persistence
    // baseline it is compared against; shadow candidates and the other tiers stay private.
    const servingMetricsTier = metricsTierForServing(servingTier as ServingTier);
    const publicTiers = new Set<MetricsTier>(['persistence']);
    if (servingMetricsTier) publicTiers.add(servingMetricsTier);
    const summarise = (row: ModelVersionRow | null): ModelVersionSummary | null => {
      if (!row) return null;
      const full = toModelVersionSummary(row);
      return admin ? full : { ...full, metrics_val: null, gate: null };
    };

    const body: ModelResponse = {
      city: { slug: city.slug, name: city.name, tz: city.tz },
      data_since: dataSince ? dataSince.toISOString() : null,
      n_stations_active: nStationsActive,
      collector: {
        last_ok_at: collectorLastOkAt ? collectorLastOkAt.toISOString() : null,
        // getCollectorUptime7d returns a 0–1 fraction; the wire field is a
        // percentage (docs/api.md §4), rendered as `<n>%` by the web client.
        uptime_7d_pct: uptime7d === null ? null : Math.round(uptime7d * 1000) / 10,
      },
      predictor: {
        last_run_at: predictorLastRunAt ? predictorLastRunAt.toISOString() : null,
        serving_tier: servingTier as ServingTier,
      },
      active: { gbm: summarise(activeGbm), bd: summarise(activeBd) },
      metrics: metricsRows
        .filter((r) => admin || publicTiers.has(r.tier as MetricsTier))
        .map((r) => ({
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
      versions: admin ? versionRows.map(toModelVersionSummary) : [],
      viewer: { is_admin: admin },
    };
    // The body depends on the session cookie: the operator view must never land in a
    // shared cache, and a browser must not reuse a cached public body after signing in.
    res.setHeader('Vary', 'Cookie');
    sendJson(
      res,
      200,
      modelResponseSchema,
      body,
      deps.config,
      admin ? 'private, no-store' : 'public, max-age=300',
    );
  });

  router.get('/model/versions/:id', async (req, res) => {
    const id = parseIntParam(req.params.id);
    if (id === null) throw notFound('Unknown model version');
    // Operator-only; a 404 rather than a 403 so the public view has nothing to probe.
    if (!(await isAdminRequest(deps, req))) throw notFound('Unknown model version');
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
    res.setHeader('Vary', 'Cookie');
    sendJson(res, 200, modelVersionDetailResponseSchema, body, deps.config, 'private, no-store');
  });

  return router;
}
