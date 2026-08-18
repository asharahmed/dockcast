/** `docs/api.md` §5 — /auth/register, /auth/login, /auth/logout, /auth/me. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { userResponseSchema } from '@dockcast/shared';
import { setupTestApp, type TestContext } from './helpers/testApp.js';

const FETCH_HEADER = { 'X-Requested-With': 'fetch' };

describe('auth: register / login / logout / me', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await setupTestApp();
  }, 60_000);

  afterAll(async () => {
    await ctx.teardown();
  });

  it('register: 201, sets the session cookie, and logs the user in', async () => {
    const agent = request.agent(ctx.app);
    const res = await agent
      .post('/api/v1/auth/register')
      .set(FETCH_HEADER)
      .send({ email: 'alice@example.com', password: 'correct horse battery' });

    expect(res.status).toBe(201);
    const body = userResponseSchema.parse(res.body);
    expect(body.user.email).toBe('alice@example.com');
    expect(res.headers['set-cookie']?.[0]).toMatch(/^dockcast\.sid=/);
    expect(res.headers['cache-control']).toBe('no-store');

    // The cookie jar carries the session; /auth/me now resolves without re-authenticating.
    const me = await agent.get('/api/v1/auth/me');
    expect(me.status).toBe(200);
    expect(userResponseSchema.parse(me.body).user.id).toBe(body.user.id);
  });

  it('register: 409 on a duplicate email, case-insensitively', async () => {
    const agent = request.agent(ctx.app);
    await agent
      .post('/api/v1/auth/register')
      .set(FETCH_HEADER)
      .send({ email: 'bob@example.com', password: 'correct horse battery' });

    const dupe = await request(ctx.app)
      .post('/api/v1/auth/register')
      .set(FETCH_HEADER)
      .send({ email: 'BOB@Example.com', password: 'another password entirely' });

    expect(dupe.status).toBe(409);
    expect(dupe.body.error.code).toBe('conflict');
  });

  it('login: 200 with the correct password, sets a fresh session cookie', async () => {
    await request(ctx.app)
      .post('/api/v1/auth/register')
      .set(FETCH_HEADER)
      .send({ email: 'carol@example.com', password: 'a very good password' });

    const agent = request.agent(ctx.app);
    const res = await agent
      .post('/api/v1/auth/login')
      .set(FETCH_HEADER)
      .send({ email: 'carol@example.com', password: 'a very good password' });

    expect(res.status).toBe(200);
    expect(userResponseSchema.parse(res.body).user.email).toBe('carol@example.com');
    expect(res.headers['set-cookie']?.[0]).toMatch(/^dockcast\.sid=/);
  });

  it('login: 401 on wrong password and 401 with the identical message on an unknown email', async () => {
    await request(ctx.app)
      .post('/api/v1/auth/register')
      .set(FETCH_HEADER)
      .send({ email: 'dave@example.com', password: 'daves great password' });

    const wrongPassword = await request(ctx.app)
      .post('/api/v1/auth/login')
      .set(FETCH_HEADER)
      .send({ email: 'dave@example.com', password: 'not his password' });
    const unknownEmail = await request(ctx.app)
      .post('/api/v1/auth/login')
      .set(FETCH_HEADER)
      .send({ email: 'nobody-here@example.com', password: 'whatever12345' });

    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(wrongPassword.body.error.code).toBe('unauthorized');
    expect(wrongPassword.body.error.message).toBe(unknownEmail.body.error.message);
  });

  it('logout: 204, and /auth/me is 401 afterwards', async () => {
    const agent = request.agent(ctx.app);
    await agent
      .post('/api/v1/auth/register')
      .set(FETCH_HEADER)
      .send({ email: 'erin@example.com', password: 'erins great password' });

    const logout = await agent.post('/api/v1/auth/logout').set(FETCH_HEADER);
    expect(logout.status).toBe(204);

    const me = await agent.get('/api/v1/auth/me');
    expect(me.status).toBe(401);
  });

  it('/auth/me: 401 without any session', async () => {
    const res = await request(ctx.app).get('/api/v1/auth/me');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('unauthorized');
  });

  it('validation: 400 on a too-short password', async () => {
    const res = await request(ctx.app)
      .post('/api/v1/auth/register')
      .set(FETCH_HEADER)
      .send({ email: 'short@example.com', password: 'short' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_error');
  });

  it('requireFetchHeader: 403 on POST without X-Requested-With', async () => {
    const res = await request(ctx.app)
      .post('/api/v1/auth/register')
      .send({ email: 'noheader@example.com', password: 'a fine password here' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('forbidden');
  });
});

describe('auth: rate limiting (isolated app instance)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await setupTestApp();
  }, 60_000);

  afterAll(async () => {
    await ctx.teardown();
  });

  it('429s after 10 combined register+login requests / 15 min / IP', async () => {
    let last: { status: number; body: unknown } = { status: 0, body: null };
    for (let i = 0; i < 11; i++) {
      // eslint-disable-next-line no-await-in-loop
      last = await request(ctx.app)
        .post('/api/v1/auth/login')
        .set(FETCH_HEADER)
        .send({ email: `nobody-${i}@example.com`, password: 'irrelevant password' });
    }
    expect(last.status).toBe(429);
    expect((last.body as { error: { code: string } }).error.code).toBe('rate_limited');
  }, 30_000);
});
