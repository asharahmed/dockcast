/**
 * `docs/api.md` §5 — /auth/register, /auth/login, /auth/logout, /auth/me,
 * /auth/providers, and the OAuth flows: Google (GET callback) and Apple
 * (cross-site form_post callback) — handshakes in `oauth_handshakes`.
 */
import { Router, urlencoded } from 'express';
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
import { findIdentityUserId, linkIdentity, type Provider } from '../services/identities.queries.js';
import { createHandshake, consumeHandshake } from '../services/oauth.queries.js';
import { buildGoogleAuthUrl, exchangeGoogleCode, OAuthError, randomToken } from '../auth/googleOidc.js';
import { buildAppleAuthUrl, exchangeAppleCode } from '../auth/appleOidc.js';

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
  const appleEnabled =
    deps.config.appleServicesId !== null &&
    deps.config.appleTeamId !== null &&
    deps.config.appleKeyId !== null &&
    deps.config.applePrivateKey !== null;
  const baseUrl = deps.config.publicBaseUrl.replace(/\/$/, '');
  const googleRedirectUri = `${baseUrl}/api/v1/auth/google/callback`;
  const appleRedirectUri = `${baseUrl}/api/v1/auth/apple/callback`;

  router.get('/auth/providers', (req, res) => {
    // no-store: this is config-derived, and an HTTP-cached `false` hides the
    // OAuth button for minutes right after a provider is enabled — the web
    // client already caches it in memory for the session.
    sendJson(
      res,
      200,
      authProvidersResponseSchema,
      { google: googleEnabled, apple: appleEnabled },
      deps.config,
      'no-store',
    );
  });

  /** `?next=` must stay a same-origin path — anything else falls back to /commutes. */
  function sanitizeNext(raw: unknown): string {
    return typeof raw === 'string' && raw.startsWith('/') && !raw.startsWith('//')
      ? raw
      : '/commutes';
  }

  /** Identity resolved: link/provision the user, regenerate the session, land on `next`. */
  async function finishOAuth(
    req: Parameters<Parameters<Router['get']>[1]>[0],
    res: Parameters<Parameters<Router['get']>[1]>[1],
    provider: Provider,
    identity: { subject: string; email: string },
    next: string,
  ): Promise<void> {
    let userId = await findIdentityUserId(deps.pool, provider, identity.subject);
    if (userId === null) {
      // First sign-in with this provider account: attach to the existing user
      // with the same (provider-verified) email, or provision a passwordless
      // user. Apple private-relay addresses simply provision a fresh user.
      const existing = await findUserByEmailCI(deps.pool, identity.email);
      const user = existing ?? (await createUser(deps.pool, identity.email, null));
      await linkIdentity(deps.pool, provider, identity.subject, user.id, identity.email);
      userId = user.id;
    }
    await regenerateSession(req);
    req.session.userId = userId;
    await touchLastLogin(deps.pool, userId, deps.now());
    res.redirect(303, next);
  }

  // Separate bucket from register/login: one sign-in legitimately costs two
  // requests (start + callback) and users bounce back from providers on retries.
  const oauthLimiter = createRateLimiter(15 * 60_000, 30);

  router.get('/auth/google', oauthLimiter, async (req, res) => {
    if (!googleEnabled) throw notFound('Google sign-in is not configured');
    const state = randomToken();
    const nonce = randomToken();
    const verifier = randomToken();
    await createHandshake(deps.pool, state, {
      provider: 'google',
      nonce,
      verifier,
      next: sanitizeNext(req.query.next),
    });
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
    const { code, state } = req.query;
    if (!googleEnabled || typeof code !== 'string' || typeof state !== 'string') {
      fail();
      return;
    }
    const handshake = await consumeHandshake(deps.pool, state, 'google');
    if (!handshake) {
      fail();
      return;
    }

    try {
      const identity = await exchangeGoogleCode({
        code,
        verifier: handshake.verifier as string,
        nonce: handshake.nonce,
        clientId: deps.config.googleClientId as string,
        clientSecret: deps.config.googleClientSecret as string,
        redirectUri: googleRedirectUri,
        now: deps.now(),
        fetchImpl: deps.fetchImpl,
      });
      await finishOAuth(req, res, 'google', identity, handshake.next);
    } catch (err) {
      if (!(err instanceof OAuthError)) throw err;
      deps.logger.warn({ err: err.message }, 'google oauth exchange failed');
      fail();
    }
  });

  router.get('/auth/apple', oauthLimiter, async (req, res) => {
    if (!appleEnabled) throw notFound('Sign in with Apple is not configured');
    const state = randomToken();
    const nonce = randomToken();
    await createHandshake(deps.pool, state, {
      provider: 'apple',
      nonce,
      verifier: null,
      next: sanitizeNext(req.query.next),
    });
    res.redirect(
      buildAppleAuthUrl({
        servicesId: deps.config.appleServicesId as string,
        redirectUri: appleRedirectUri,
        state,
        nonce,
      }),
    );
  });

  // Apple posts the result cross-site (`response_mode=form_post`): urlencoded
  // body, no session cookie (SameSite=Lax), exempt from the fetch-header CSRF
  // check — the single-use server-side `state` is the CSRF protection.
  router.post(
    '/auth/apple/callback',
    oauthLimiter,
    urlencoded({ extended: false }),
    async (req, res) => {
      const fail = (): void => res.redirect(303, '/login?oauth=failed');
      const body = req.body as Record<string, unknown>;
      const code = body.code;
      const state = body.state;
      if (!appleEnabled || typeof code !== 'string' || typeof state !== 'string') {
        fail();
        return;
      }
      const handshake = await consumeHandshake(deps.pool, state, 'apple');
      if (!handshake) {
        fail();
        return;
      }

      try {
        const identity = await exchangeAppleCode({
          code,
          nonce: handshake.nonce,
          servicesId: deps.config.appleServicesId as string,
          teamId: deps.config.appleTeamId as string,
          keyId: deps.config.appleKeyId as string,
          privateKeyPem: deps.config.applePrivateKey as string,
          redirectUri: appleRedirectUri,
          now: deps.now(),
          fetchImpl: deps.fetchImpl,
        });
        await finishOAuth(req, res, 'apple', identity, handshake.next);
      } catch (err) {
        if (!(err instanceof OAuthError)) throw err;
        deps.logger.warn({ err: err.message }, 'apple oauth exchange failed');
        fail();
      }
    },
  );

  return router;
}
