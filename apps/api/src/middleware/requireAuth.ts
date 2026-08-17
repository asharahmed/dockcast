/**
 * Stub session-auth guard. `docs/plan.md` WP-8 replaces this with real
 * Postgres-backed session checks (`connect-pg-simple`); until then every
 * request is unauthorized, matching `docs/api.md` §0's `401 unauthorized`.
 */
import type { RequestHandler } from 'express';
import { unauthorized } from './errors.js';

export const requireAuth: RequestHandler = (_req, _res, next) => {
  next(unauthorized());
};
