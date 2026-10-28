/**
 * `docs/api.md` §1 — GET /status: public training progress and service health for the `/status` page.
 */
import { Router } from 'express';
import { statusResponseSchema, type StatusResponse } from '@dockcast/shared';
import type { RouteDeps } from '../deps.js';
import { sendJson } from '../lib/respond.js';
import { createRateLimiter } from '../middleware/rateLimit.js';
import { getGlobalCollectorLastOkAt } from '../services/worker.queries.js';
import {
  getLastPredictRun,
  getRecentTrainRuns,
  getReferenceTrainRun,
} from '../services/status.queries.js';
import {
  buildCurrent,
  buildHistoryRow,
  buildReference,
  CURRENT_MAX_AGE_S,
} from '../status/compute.js';
import { API_VERSION } from '../version.js';

/** Collector polls every 60 s; five missed polls is "down". */
const COLLECTOR_MAX_AGE_S = 300;
/** The predict loop writes a run each cycle (<= 15 min apart). */
const PREDICT_MAX_AGE_S = 1800;

const ageS = (d: Date | null, now: Date): number | null =>
  d ? Math.max(0, Math.round((now.getTime() - d.getTime()) / 1000)) : null;

/** Short hex commit id from the `GIT_SHA` env if the deploy set one; anything else is dropped. */
function gitSha(): string | null {
  const v = process.env.GIT_SHA;
  return v && /^[0-9a-f]{7,40}$/i.test(v) ? v.slice(0, 7).toLowerCase() : null;
}

export function statusRouter(deps: RouteDeps): Router {
  const router = Router();
  // Per-IP: the page polls every 5 s during a run (12/min), so leave room for a few tabs.
  const limiter = createRateLimiter(60_000, 120);

  router.get('/status', limiter, async (req, res) => {
    const now = deps.now();
    try {
      const [runs, reference, predict, collectorOkAt] = await Promise.all([
        getRecentTrainRuns(deps.pool),
        getReferenceTrainRun(deps.pool),
        getLastPredictRun(deps.pool),
        getGlobalCollectorLastOkAt(deps.pool),
      ]);

      const latest = runs[0];
      const current =
        latest &&
        latest.finished_at === null &&
        (now.getTime() - latest.started_at.getTime()) / 1000 <= CURRENT_MAX_AGE_S
          ? buildCurrent(latest, reference ? buildReference(reference) : null, now)
          : null;
      const lastFinished = runs.find((r) => r.finished_at !== null)?.finished_at ?? null;

      const collectorAge = ageS(collectorOkAt, now);
      const predictAge = ageS(predict?.finished_at ?? null, now);
      const body: StatusResponse = {
        generated_at: now.toISOString(),
        train: {
          current,
          history: runs.map(buildHistoryRow),
          last_finished_age_s: ageS(lastFinished, now),
        },
        services: {
          predict: {
            age_s: predictAge,
            ok: predict && predictAge !== null ? predict.ok === true && predictAge <= PREDICT_MAX_AGE_S : null,
          },
          collector: {
            age_s: collectorAge,
            ok: collectorAge === null ? null : collectorAge <= COLLECTOR_MAX_AGE_S,
          },
          db: { ok: true },
          api: { version: API_VERSION, git_sha: gitSha() },
        },
      };
      sendJson(res, 200, statusResponseSchema, body, deps.config, 'no-store');
    } catch (err) {
      req.log.warn({ err }, 'status: database unreachable');
      const body: StatusResponse = {
        generated_at: now.toISOString(),
        train: { current: null, history: [], last_finished_age_s: null },
        services: {
          predict: { age_s: null, ok: null },
          collector: { age_s: null, ok: null },
          db: { ok: false },
          api: { version: API_VERSION, git_sha: gitSha() },
        },
      };
      sendJson(res, 503, statusResponseSchema, body, deps.config, 'no-store');
    }
  });

  return router;
}
