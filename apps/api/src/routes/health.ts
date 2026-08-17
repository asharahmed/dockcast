/**
 * `docs/api.md` §1 — GET /health.
 */
import { Router } from 'express';
import { healthResponseSchema, type HealthResponse } from '@dockcast/shared';
import type { RouteDeps } from '../deps.js';
import { sendJson } from '../lib/respond.js';
import {
  getGlobalCollectorLastOkAt,
  getGlobalPredictorLastRunAt,
} from '../services/worker.queries.js';
import { API_VERSION } from '../version.js';

export function healthRouter(deps: RouteDeps): Router {
  const router = Router();

  router.get('/health', async (req, res) => {
    try {
      const [collectorLastOkAt, predictorLastRunAt] = await Promise.all([
        getGlobalCollectorLastOkAt(deps.pool),
        getGlobalPredictorLastRunAt(deps.pool),
      ]);
      const body: HealthResponse = {
        ok: true,
        version: API_VERSION,
        db: true,
        collector_last_ok_at: collectorLastOkAt ? collectorLastOkAt.toISOString() : null,
        predictor_last_run_at: predictorLastRunAt ? predictorLastRunAt.toISOString() : null,
      };
      sendJson(res, 200, healthResponseSchema, body, deps.config, 'no-store');
    } catch (err) {
      req.log.warn({ err }, 'health check: database unreachable');
      const body: HealthResponse = {
        ok: false,
        version: API_VERSION,
        db: false,
        collector_last_ok_at: null,
        predictor_last_run_at: null,
      };
      sendJson(res, 503, healthResponseSchema, body, deps.config, 'no-store');
    }
  });

  return router;
}
