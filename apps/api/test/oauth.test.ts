/** Google OAuth sign-in (docs/api.md §5): /auth/providers, /auth/google, /auth/google/callback. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { setupTestApp, type TestContext } from './helpers/testApp.js';
import { GOOGLE_TOKEN_URL } from '../src/auth/googleOidc.js';
import { FIXED_NOW } from './seed.js';

const GOOGLE_ENV = { GOOGLE_CLIENT_ID: 'test-client-id', GOOGLE_CLIENT_SECRET: 'test-client-secret' };

/** Unsigned JWT with the given payload — the exchange trusts the token endpoint, not the signature. */
function fakeIdToken(payload: Record<string, unknown>): string {
  const enc = (obj: unknown): string => Buffer.from(JSON.stringify(obj)).toString('base64url');
  return `${enc({ alg: 'RS256', typ: 'JWT' })}.${enc(payload)}.sig`;
}

function googleClaims(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    iss: 'https://accounts.google.com',
    aud: 'test-client-id',
    sub: 'google-sub-1',
    exp: Math.floor(FIXED_NOW.getTime() / 1000) + 3600,
    email: 'rider@example.com',
    email_verified: true,
    ...overrides,
  };
}

describe('OAuth sign-in', () => {
  describe('unconfigured', () => {
    let ctx: TestContext;
    beforeAll(async () => {
      ctx = await setupTestApp();
    }, 60_000);
    afterAll(async () => {
      await ctx.teardown();
    });

    it('/auth/providers reports google: false', async () => {
      const res = await request(ctx.app).get('/api/v1/auth/providers');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ google: false, apple: false });
    });

    it('/auth/google 404s', async () => {
      const res = await request(ctx.app).get('/api/v1/auth/google');
      expect(res.status).toBe(404);
    });
  });

  describe('configured', () => {
    let ctx: TestContext;
    /** The nonce the route generated, extracted from the redirect to Google. */
    let sentNonce = '';

    beforeAll(async () => {
      ctx = await setupTestApp(GOOGLE_ENV, {
        fetchImpl: (async (url: unknown, init?: RequestInit) => {
          expect(String(url)).toBe(GOOGLE_TOKEN_URL);
          const params = new URLSearchParams(String(init?.body));
          expect(params.get('grant_type')).toBe('authorization_code');
          const claims = googleClaims({
            nonce: sentNonce,
            sub: `google-sub-${params.get('code')}`,
            email: `${params.get('code')}@example.com`,
          });
          return new Response(JSON.stringify({ id_token: fakeIdToken(claims) }), { status: 200 });
        }) as typeof fetch,
      });
    }, 60_000);
    afterAll(async () => {
      await ctx.teardown();
    });

    /** Runs the start leg, returns the session cookie + state + Google URL. */
    async function startFlow(next = '/commutes'): Promise<{ cookie: string; state: string }> {
      const res = await request(ctx.app).get(`/api/v1/auth/google?next=${encodeURIComponent(next)}`);
      expect(res.status).toBe(302);
      const location = new URL(res.headers.location as string);
      expect(location.origin).toBe('https://accounts.google.com');
      expect(location.searchParams.get('client_id')).toBe('test-client-id');
      expect(location.searchParams.get('code_challenge_method')).toBe('S256');
      sentNonce = location.searchParams.get('nonce') as string;
      return {
        cookie: (res.headers['set-cookie'] as unknown as string[])[0]?.split(';')[0] as string,
        state: location.searchParams.get('state') as string,
      };
    }

    it('provisions a user on first sign-in and signs them in', async () => {
      const { cookie, state } = await startFlow('/map-route');
      const res = await request(ctx.app)
        .get(`/api/v1/auth/google/callback?code=alice&state=${state}`)
        .set('Cookie', cookie);
      expect(res.status).toBe(302);
      expect(res.headers.location).toBe('/map-route');

      const sessionCookie = (res.headers['set-cookie'] as unknown as string[])[0]?.split(
        ';',
      )[0] as string;
      const me = await request(ctx.app).get('/api/v1/auth/me').set('Cookie', sessionCookie);
      expect(me.status).toBe(200);
      expect(me.body.user.email).toBe('alice@example.com');

      // Same Google account again → same user, no duplicate.
      const again = await startFlow();
      const res2 = await request(ctx.app)
        .get(`/api/v1/auth/google/callback?code=alice&state=${again.state}`)
        .set('Cookie', again.cookie);
      expect(res2.status).toBe(302);
      const users = await ctx.pool.query(`SELECT id, password_hash FROM users WHERE email = 'alice@example.com'`);
      expect(users.rowCount).toBe(1);
      expect(users.rows[0].password_hash).toBeNull();
    });

    it('links to an existing password account with the same email', async () => {
      const reg = await request(ctx.app)
        .post('/api/v1/auth/register')
        .set('X-Requested-With', 'fetch')
        .send({ email: 'bob@example.com', password: 'longenoughpw' });
      expect(reg.status).toBe(201);

      const { cookie, state } = await startFlow();
      const res = await request(ctx.app)
        .get(`/api/v1/auth/google/callback?code=bob&state=${state}`)
        .set('Cookie', cookie);
      expect(res.status).toBe(302);

      const users = await ctx.pool.query(`SELECT id FROM users WHERE email = 'bob@example.com'`);
      expect(users.rowCount).toBe(1);
      const idents = await ctx.pool.query(
        `SELECT user_id FROM auth_identities WHERE provider = 'google' AND subject = 'google-sub-bob'`,
      );
      expect(idents.rows[0].user_id).toBe(users.rows[0].id);
    });

    it('rejects a state mismatch with a redirect to /login?oauth=failed', async () => {
      const { cookie } = await startFlow();
      const res = await request(ctx.app)
        .get('/api/v1/auth/google/callback?code=x&state=wrong')
        .set('Cookie', cookie);
      expect(res.status).toBe(302);
      expect(res.headers.location).toBe('/login?oauth=failed');
    });

    it('rejects a callback with no handshake in the session', async () => {
      const res = await request(ctx.app).get('/api/v1/auth/google/callback?code=x&state=y');
      expect(res.status).toBe(302);
      expect(res.headers.location).toBe('/login?oauth=failed');
    });

    it('password login on an OAuth-only account fails like bad credentials', async () => {
      const res = await request(ctx.app)
        .post('/api/v1/auth/login')
        .set('X-Requested-With', 'fetch')
        .send({ email: 'alice@example.com', password: 'whateverpass' });
      expect(res.status).toBe(401);
    });
  });
});
