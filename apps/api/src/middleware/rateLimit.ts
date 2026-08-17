/**
 * `docs/api.md` §0 — rate limits (`429 rate_limited`). A factory, not a
 * shared singleton: each `createApp()` call must get its own limiter
 * instance/store so app instances (notably in tests) don't share counters.
 */
import { rateLimit } from 'express-rate-limit';
import type { RequestHandler } from 'express';

export function createRateLimiter(windowMs: number, limit: number): RequestHandler {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_req, res) => {
      res.status(429).json({
        error: { code: 'rate_limited', message: 'Too many requests, please try again later.' },
      });
    },
  });
}
