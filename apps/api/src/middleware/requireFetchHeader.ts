/**
 * `docs/api.md` §0 — CSRF: state-changing routes (POST/PATCH/DELETE) require
 * header `X-Requested-With: fetch`; ignored on GET/HEAD (and therefore safe
 * to mount globally, ahead of WP-8's state-changing routes).
 */
import type { RequestHandler } from 'express';
import { forbidden } from './errors.js';

const STATE_CHANGING_METHODS = new Set(['POST', 'PATCH', 'DELETE']);

/**
 * Apple's OAuth callback is a cross-site form POST from appleid.apple.com —
 * it can't carry our header. CSRF protection for it is the single-use,
 * unguessable `state` looked up server-side (docs/api.md §5).
 */
const EXEMPT_PATHS = new Set(['/api/v1/auth/apple/callback']);

export const requireFetchHeader: RequestHandler = (req, res, next) => {
  if (!STATE_CHANGING_METHODS.has(req.method) || EXEMPT_PATHS.has(req.path)) {
    next();
    return;
  }
  if (req.header('X-Requested-With') !== 'fetch') {
    next(forbidden('Missing or invalid X-Requested-With header'));
    return;
  }
  next();
};
