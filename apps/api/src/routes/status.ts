/**
 * `docs/api.md` §1 — GET /status: public overall-app status for the `/status` page. One snapshot is
 * computed at most every 15 s and served to everyone (single-flight, in-process), so the endpoint's
 * database cost does not depend on traffic. See "Public status page threat model" in `docs/api.md`.
 */
import { Router } from 'express';
import { statusResponseSchema, type StatusResponse } from '@dockcast/shared';
import type { RouteDeps } from '../deps.js';
import { sendJson } from '../lib/respond.js';
import { createRateLimiter } from '../middleware/rateLimit.js';
import { createSnapshotCache } from '../status/cache.js';
import type { LatencyTracker } from '../status/latency.js';
import { buildSnapshot, unavailableSnapshot } from '../status/snapshot.js';

export const SNAPSHOT_TTL_MS = 15_000;

interface Cached {
  status: number;
  body: StatusResponse;
}

export function statusRouter(
  deps: RouteDeps,
  extra: { deployedAt: Date; latency: LatencyTracker },
): Router {
  const router = Router();
  // Per-IP limiter; no RateLimit-* headers so the limit is not advertised.
  const limiter = createRateLimiter(60_000, 120, { headers: false });
  const cache = createSnapshotCache<Cached>(
    async () => {
      const snap = { pool: deps.pool, now: deps.now, deployedAt: extra.deployedAt, latency: extra.latency };
      try {
        return { status: 200, body: await buildSnapshot(snap) };
      } catch (err) {
        deps.logger.warn({ err }, 'status: snapshot failed');
        return { status: 503, body: unavailableSnapshot(snap) };
      }
    },
    SNAPSHOT_TTL_MS,
    () => deps.now().getTime(),
  );

  router.get('/status', limiter, async (_req, res) => {
    const { status, body } = await cache.get();
    sendJson(res, status, statusResponseSchema, body, deps.config, 'public, max-age=10');
  });

  return router;
}
