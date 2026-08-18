/**
 * Session-auth guard. `docs/api.md` §0: `401 unauthorized` when there is no
 * (or an expired) session. Requires `createSessionMiddleware` (`session.ts`)
 * to be mounted ahead of this in the stack.
 */
import type { RequestHandler } from 'express';
import { unauthorized } from './errors.js';

export const requireAuth: RequestHandler = (req, _res, next) => {
  if (!req.session?.userId) {
    next(unauthorized());
    return;
  }
  next();
};
