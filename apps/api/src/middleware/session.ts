/**
 * `docs/api.md` §5 / §9 — server-side sessions in the existing `session`
 * table (created by `db/migrations/0001_init.sql`; `connect-pg-simple`'s
 * default schema, `createTableIfMissing: false`). Cookie `dockcast.sid`
 * (httpOnly, `Secure` in production, `SameSite=Lax`, 30-day rolling).
 */
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import type { RequestHandler } from 'express';
import type { Pool } from '@dockcast/db';
import type { Config } from '../config.js';

// Module augmentation: everything under WP-8 reads/writes `req.session.userId`.
// This file is always part of the `src` TS program (imported by `app.ts`), so
// the augmentation applies project-wide.
declare module 'express-session' {
  interface SessionData {
    userId?: string;
    // In-flight OAuth handshake (set by GET /auth/google, consumed by its
    // callback; wiped by the post-login session regeneration).
    oauth?: {
      provider: 'google';
      state: string;
      nonce: string;
      verifier: string;
      next: string;
    };
  }
}

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

/** Builds the `express-session` middleware, backed by `connect-pg-simple` on `pool`. */
export function createSessionMiddleware(pool: Pool, config: Config): RequestHandler {
  const PgSession = connectPgSimple(session);
  const store = new PgSession({
    pool,
    tableName: 'session',
    createTableIfMissing: false,
  });

  return session({
    store,
    name: 'dockcast.sid',
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    proxy: config.nodeEnv === 'production' ? true : undefined,
    cookie: {
      httpOnly: true,
      // 'auto': Secure iff the request is HTTPS (behind Caddy this comes from X-Forwarded-Proto via
      // `trust proxy`), so production gets Secure cookies while a plain-HTTP local stack still works.
      // In production we additionally refuse to run without HTTPS semantics via `proxy: true` below.
      secure: 'auto',
      sameSite: 'lax',
      maxAge: THIRTY_DAYS_MS,
    },
  });
}
