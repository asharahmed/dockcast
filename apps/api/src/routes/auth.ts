/**
 * `docs/api.md` §5 — /auth/register, /auth/login, /auth/logout, /auth/me.
 */
import { Router } from 'express';
import argon2 from 'argon2';
import {
  registerRequestSchema,
  loginRequestSchema,
  userResponseSchema,
  type UserResponse,
} from '@dockcast/shared';
import type { RouteDeps } from '../deps.js';
import { sendJson } from '../lib/respond.js';
import { conflict, unauthorized } from '../middleware/errors.js';
import { parseBody } from '../lib/validate.js';
import { createRateLimiter } from '../middleware/rateLimit.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { regenerateSession, destroySession } from '../lib/sessionAsync.js';
import { createUser, findUserByEmailCI, findUserById, touchLastLogin } from '../services/users.queries.js';
import type { UserRow } from '../services/users.queries.js';

/** Same message for both "unknown email" and "wrong password" (`docs/api.md` §5). */
const INVALID_CREDENTIALS_MESSAGE = 'Invalid email or password';

function toUserResponse(user: UserRow): UserResponse {
  return { user: { id: user.id, email: user.email, created_at: user.created_at.toISOString() } };
}

export function authRouter(deps: RouteDeps): Router {
  const router = Router();
  // Shared bucket across register+login — docs/api.md §0: "auth endpoints: 10 req / 15 min / IP".
  const authLimiter = createRateLimiter(15 * 60_000, 10);

  router.post('/auth/register', authLimiter, async (req, res) => {
    const body = parseBody(registerRequestSchema, req.body);

    const existing = await findUserByEmailCI(deps.pool, body.email);
    if (existing) throw conflict('Email already registered');

    const passwordHash = await argon2.hash(body.password, { type: argon2.argon2id });
    const user = await createUser(deps.pool, body.email, passwordHash);

    await regenerateSession(req);
    req.session.userId = user.id;
    await touchLastLogin(deps.pool, user.id, deps.now());

    sendJson(res, 201, userResponseSchema, toUserResponse(user), deps.config, 'no-store');
  });

  router.post('/auth/login', authLimiter, async (req, res) => {
    const body = parseBody(loginRequestSchema, req.body);

    const user = await findUserByEmailCI(deps.pool, body.email);
    if (!user) throw unauthorized(INVALID_CREDENTIALS_MESSAGE);

    const valid = await argon2.verify(user.password_hash, body.password);
    if (!valid) throw unauthorized(INVALID_CREDENTIALS_MESSAGE);

    await regenerateSession(req);
    req.session.userId = user.id;
    await touchLastLogin(deps.pool, user.id, deps.now());

    sendJson(res, 200, userResponseSchema, toUserResponse(user), deps.config, 'no-store');
  });

  router.post('/auth/logout', async (req, res) => {
    await destroySession(req);
    res.clearCookie('dockcast.sid');
    res.status(204).end();
  });

  router.get('/auth/me', requireAuth, async (req, res) => {
    const user = await findUserById(deps.pool, req.session.userId as string);
    if (!user) throw unauthorized();
    sendJson(res, 200, userResponseSchema, toUserResponse(user), deps.config, 'no-store');
  });

  return router;
}
