/**
 * `docs/api.md` §0 — every response has `X-Request-Id`: echo an inbound one,
 * else generate a uuid. Runs before `pino-http` so request logs share the id.
 */
import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';

// `req.id` (and `req.log`) are declared globally on `http.IncomingMessage`
// by `pino-http`'s own type declarations (loaded once anything imports
// `pino-http`, e.g. `app.ts`) — Express's `Request` extends `IncomingMessage`,
// so no separate module augmentation is needed here.

export const requestId: RequestHandler = (req, res, next) => {
  const inbound = req.header('X-Request-Id');
  const id = inbound && inbound.trim() !== '' ? inbound : randomUUID();
  req.id = id;
  res.setHeader('X-Request-Id', id);
  next();
};
