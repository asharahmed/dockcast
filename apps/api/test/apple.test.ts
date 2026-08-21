/** Sign in with Apple (docs/api.md §5): form_post callback, ES256 client secret. */
import { createVerify, generateKeyPairSync } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { setupTestApp, type TestContext } from './helpers/testApp.js';
import { APPLE_TOKEN_URL, appleClientSecret } from '../src/auth/appleOidc.js';
import { FIXED_NOW } from './seed.js';

const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const PRIVATE_PEM = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

const APPLE_ENV = {
  APPLE_SERVICES_ID: 'ca.aahmed.dockcast.web',
  APPLE_TEAM_ID: 'TEAM123456',
  APPLE_KEY_ID: 'KEY1234567',
  // env files are single-line: the config layer unescapes literal \n.
  APPLE_PRIVATE_KEY: PRIVATE_PEM.replace(/\n/g, '\\n'),
};

function fakeIdToken(payload: Record<string, unknown>): string {
  const enc = (obj: unknown): string => Buffer.from(JSON.stringify(obj)).toString('base64url');
  return `${enc({ alg: 'RS256', typ: 'JWT' })}.${enc(payload)}.sig`;
}

describe('appleClientSecret', () => {
  it('produces a valid ES256 JWT with Apple’s required claims', () => {
    const jwt = appleClientSecret({
      teamId: 'TEAM123456',
      keyId: 'KEY1234567',
      servicesId: 'ca.aahmed.dockcast.web',
      privateKeyPem: PRIVATE_PEM,
      now: FIXED_NOW,
    });
    const [header, payload, signature] = jwt.split('.') as [string, string, string];
    expect(JSON.parse(Buffer.from(header, 'base64url').toString())).toMatchObject({
      alg: 'ES256',
      kid: 'KEY1234567',
    });
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString());
    expect(claims).toMatchObject({
      iss: 'TEAM123456',
      sub: 'ca.aahmed.dockcast.web',
      aud: 'https://appleid.apple.com',
    });
    expect(claims.exp - claims.iat).toBe(300);

    const verifier = createVerify('SHA256');
    verifier.update(`${header}.${payload}`);
    const ok = verifier.verify(
      { key: publicKey, dsaEncoding: 'ieee-p1363' },
      Buffer.from(signature, 'base64url'),
    );
    expect(ok).toBe(true);
  });
});

describe('Apple sign-in flow', () => {
  let ctx: TestContext;
  let sentNonce = '';

  beforeAll(async () => {
    ctx = await setupTestApp(APPLE_ENV, {
      fetchImpl: (async (url: unknown, init?: RequestInit) => {
        expect(String(url)).toBe(APPLE_TOKEN_URL);
        const params = new URLSearchParams(String(init?.body));
        expect(params.get('grant_type')).toBe('authorization_code');
        // The client secret must be a 3-part JWT (details covered above).
        expect(params.get('client_secret')?.split('.')).toHaveLength(3);
        const claims = {
          iss: 'https://appleid.apple.com',
          aud: 'ca.aahmed.dockcast.web',
          sub: `apple-sub-${params.get('code')}`,
          exp: Math.floor(FIXED_NOW.getTime() / 1000) + 3600,
          nonce: sentNonce,
          email: `${params.get('code')}@privaterelay.appleid.com`,
          email_verified: 'true', // Apple sends a string on some accounts
        };
        return new Response(JSON.stringify({ id_token: fakeIdToken(claims) }), { status: 200 });
      }) as typeof fetch,
    });
  }, 60_000);
  afterAll(async () => {
    await ctx.teardown();
  });

  async function startFlow(): Promise<{ state: string }> {
    const res = await request(ctx.app).get('/api/v1/auth/apple');
    expect(res.status).toBe(302);
    const location = new URL(res.headers.location as string);
    expect(location.origin).toBe('https://appleid.apple.com');
    expect(location.searchParams.get('response_mode')).toBe('form_post');
    expect(location.searchParams.get('client_id')).toBe('ca.aahmed.dockcast.web');
    sentNonce = location.searchParams.get('nonce') as string;
    return { state: location.searchParams.get('state') as string };
  }

  it('/auth/providers reports apple: true', async () => {
    const res = await request(ctx.app).get('/api/v1/auth/providers');
    expect(res.body).toEqual({ google: false, apple: true });
  });

  it('form_post callback signs the user in without a session cookie or fetch header', async () => {
    const { state } = await startFlow();
    // Cross-site POST from Apple: urlencoded, no cookies, no X-Requested-With.
    const res = await request(ctx.app)
      .post('/api/v1/auth/apple/callback')
      .type('form')
      .send({ code: 'carol', state });
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe('/commutes');

    const sessionCookie = (res.headers['set-cookie'] as unknown as string[])[0]?.split(
      ';',
    )[0] as string;
    const me = await request(ctx.app).get('/api/v1/auth/me').set('Cookie', sessionCookie);
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe('carol@privaterelay.appleid.com');

    const idents = await ctx.pool.query(
      `SELECT user_id FROM auth_identities WHERE provider = 'apple' AND subject = 'apple-sub-carol'`,
    );
    expect(idents.rowCount).toBe(1);
  });

  it('rejects an unknown state', async () => {
    const res = await request(ctx.app)
      .post('/api/v1/auth/apple/callback')
      .type('form')
      .send({ code: 'x', state: 'wrong' });
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe('/login?oauth=failed');
  });

  it('a Google-style GET to the Apple callback is not routed', async () => {
    const res = await request(ctx.app).get('/api/v1/auth/apple/callback?code=x&state=y');
    expect(res.status).toBe(404);
  });
});

describe('cross-provider email collision', () => {
  let ctx: TestContext;
  let googleNonce = '';
  let appleNonce = '';

  beforeAll(async () => {
    ctx = await setupTestApp(
      { ...APPLE_ENV, GOOGLE_CLIENT_ID: 'test-client-id', GOOGLE_CLIENT_SECRET: 'test-secret' },
      {
        fetchImpl: (async (url: unknown) => {
          const isApple = String(url) === APPLE_TOKEN_URL;
          const claims = {
            iss: isApple ? 'https://appleid.apple.com' : 'https://accounts.google.com',
            aud: isApple ? 'ca.aahmed.dockcast.web' : 'test-client-id',
            sub: isApple ? 'apple-sub-shared' : 'google-sub-shared',
            exp: Math.floor(FIXED_NOW.getTime() / 1000) + 3600,
            nonce: isApple ? appleNonce : googleNonce,
            email: 'same-rider@example.com',
            email_verified: true,
          };
          return new Response(JSON.stringify({ id_token: fakeIdToken(claims) }), { status: 200 });
        }) as typeof fetch,
      },
    );
  }, 60_000);
  afterAll(async () => {
    await ctx.teardown();
  });

  it('same verified email from both providers merges into one account', async () => {
    const g = await request(ctx.app).get('/api/v1/auth/google');
    const gUrl = new URL(g.headers.location as string);
    googleNonce = gUrl.searchParams.get('nonce') as string;
    const gCb = await request(ctx.app).get(
      `/api/v1/auth/google/callback?code=x&state=${gUrl.searchParams.get('state')}`,
    );
    expect(gCb.status).toBe(303);

    const a = await request(ctx.app).get('/api/v1/auth/apple');
    const aUrl = new URL(a.headers.location as string);
    appleNonce = aUrl.searchParams.get('nonce') as string;
    const aCb = await request(ctx.app)
      .post('/api/v1/auth/apple/callback')
      .type('form')
      .send({ code: 'y', state: aUrl.searchParams.get('state') });
    expect(aCb.status).toBe(303);

    const users = await ctx.pool.query(
      `SELECT id FROM users WHERE email = 'same-rider@example.com'`,
    );
    expect(users.rowCount).toBe(1);
    const idents = await ctx.pool.query(
      `SELECT provider, subject FROM auth_identities WHERE user_id = $1 ORDER BY provider`,
      [users.rows[0].id],
    );
    expect(idents.rows).toEqual([
      { provider: 'apple', subject: 'apple-sub-shared' },
      { provider: 'google', subject: 'google-sub-shared' },
    ]);
  });
});
