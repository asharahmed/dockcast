/**
 * `docs/api.md` §5 — /auth/register, /auth/login, /auth/logout, /auth/me,
 * /auth/providers and the Google OAuth pair /auth/google + its callback.
 */
import { Router } from 'express';
import argon2 from 'argon2';
import {
  registerRequestSchema,
  loginRequestSchema,
  userResponseSchema,
  authProvidersResponseSchema,
  type UserResponse,
} from '@dockcast/shared';
import type { RouteDeps } from '../deps.js';
import { sendJson } from '../lib/respond.js';
import { conflict, notFound, unauthorized } from '../middleware/errors.js';
import { parseBody } from '../lib/validate.js';
import { createRateLimiter } from '../middleware/rateLimit.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { regenerateSession, destroySession } from '../lib/sessionAsync.js';
import { createUser, findUserByEmailCI, findUserById, touchLastLogin } from '../services/users.queries.js';
import type { UserRow } from '../services/users.queries.js';
import { findIdentityUserId, linkIdentity } from '../services/identities.queries.js';
import { buildGoogleAuthUrl, exchangeGoogleCode, OAuthError, randomToken } from '../auth/googleOidc.js';

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
    // Null hash = OAuth-provisioned account with no password; same message as
    // a wrong password so the response doesn't reveal which case it was.
    if (!user || user.password_hash === null) throw unauthorized(INVALID_CREDENTIALS_MESSAGE);

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

  const googleEnabled = deps.config.googleClientId !== null && deps.config.googleClientSecret !== null;
  const googleRedirectUri = `${deps.config.publicBaseUrl.replace(/\/$/, '')}/api/v1/auth/google/callback`;

  router.get('/auth/providers', (req, res) => {
    sendJson(
      res,
      200,
      authProvidersResponseSchema,
      { google: googleEnabled, apple: false },
      deps.config,
      'public, max-age=300',
    );
  });

  /** `?next=` must stay a same-origin path — anything else falls back to /commutes. */
  function sanitizeNext(raw: unknown): string {
    return typeof raw === 'string' && raw.startsWith('/') && !raw.startsWith('//')
      ? raw
      : '/commutes';
  }

  // Separate bucket from register/login: one sign-in legitimately costs two
  // requests (start + callback) and users bounce back from Google on retries.
  const oauthLimiter = createRateLimiter(15 * 60_000, 30);

  router.get('/auth/google', oauthLimiter, (req, res) => {
    if (!googleEnabled) throw notFound('Google sign-in is not configured');
    const state = randomToken();
    const nonce = randomToken();
    const verifier = randomToken();
    req.session.oauth = { provider: 'google', state, nonce, verifier, next: sanitizeNext(req.query.next) };
    res.redirect(
      buildGoogleAuthUrl({
        clientId: deps.config.googleClientId as string,
        redirectUri: googleRedirectUri,
        state,
        nonce,
        verifier,
      }),
    );
  });

  // The browser lands here from Google, so failures redirect back to /login
  // with a flag the page turns into an inline error — never a JSON envelope.
  router.get('/auth/google/callback', oauthLimiter, async (req, res) => {
    const fail = (): void => res.redirect('/login?oauth=failed');
    const handshake = req.session.oauth;
    const { code, state } = req.query;
    if (
      !googleEnabled ||
      !handshake ||
      handshake.provider !== 'google' ||
      typeof code !== 'string' ||
      typeof state !== 'string' ||
      state !== handshake.state
    ) {
      fail();
      return;
    }

    let identity;
    try {
      identity = await exchangeGoogleCode({
        code,
        verifier: handshake.verifier,
        nonce: handshake.nonce,
        clientId: deps.config.googleClientId as string,
        clientSecret: deps.config.googleClientSecret as string,
        redirectUri: googleRedirectUri,
        now: deps.now(),
        fetchImpl: deps.fetchImpl,
      });
    } catch (err) {
      if (!(err instanceof OAuthError)) throw err;
      deps.logger.warn({ err: err.message }, 'google oauth exchange failed');
      fail();
      return;
    }

    let userId = await findIdentityUserId(deps.pool, 'google', identity.subject);
    if (userId === null) {
      // First Google sign-in: attach to the existing account with the same
      // (Google-verified) email, or provision a passwordless user.
      const existing = await findUserByEmailCI(deps.pool, identity.email);
      const user = existing ?? (await createUser(deps.pool, identity.email, null));
      await linkIdentity(deps.pool, 'google', identity.subject, user.id, identity.email);
      userId = user.id;
    }

    await regenerateSession(req);
    req.session.userId = userId;
    await touchLastLogin(deps.pool, userId, deps.now());
    res.redirect(handshake.next);
  });

  return router;
}
