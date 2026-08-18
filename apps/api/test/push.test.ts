/** `docs/api.md` §7 — /push/vapid-public-key, /push/subscriptions, /push/test. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { one } from '@dockcast/db';
import {
  vapidKeyResponseSchema,
  pushSubscribeResponseSchema,
  pushTestResponseSchema,
} from '@dockcast/shared';
import type { PushTransport } from '../src/alerts/sender.js';
import { setupTestApp, type TestContext } from './helpers/testApp.js';

const FETCH_HEADER = { 'X-Requested-With': 'fetch' };

interface TransportCall {
  endpoint: string;
  payload: { title: string; body: string; url: string; tag: string };
}

/** Endpoint URL encodes the desired fake push-service response for that subscription. */
function makeTransport(): { transport: PushTransport; calls: TransportCall[] } {
  const calls: TransportCall[] = [];
  const transport: PushTransport = async (subscription, payload) => {
    calls.push({ endpoint: subscription.endpoint, payload: JSON.parse(payload) });
    if (subscription.endpoint.includes('gone-410')) return { statusCode: 410 };
    if (subscription.endpoint.includes('not-found-404')) return { statusCode: 404 };
    if (subscription.endpoint.includes('always-fails')) return { statusCode: 500 };
    return { statusCode: 201 };
  };
  return { transport, calls };
}

async function registerAgent(
  app: TestContext['app'],
  email: string,
): Promise<ReturnType<typeof request.agent>> {
  const agent = request.agent(app);
  await agent
    .post('/api/v1/auth/register')
    .set(FETCH_HEADER)
    .send({ email, password: 'a perfectly fine password' });
  return agent;
}

describe('push', () => {
  let ctx: TestContext;
  let calls: TransportCall[];

  beforeAll(async () => {
    const made = makeTransport();
    calls = made.calls;
    ctx = await setupTestApp({}, { pushTransport: made.transport });
  }, 60_000);

  afterAll(async () => {
    await ctx.teardown();
  });

  it('GET /push/vapid-public-key: public, cached, no auth required', async () => {
    const res = await request(ctx.app).get('/api/v1/push/vapid-public-key');
    expect(res.status).toBe(200);
    expect(vapidKeyResponseSchema.parse(res.body).publicKey).toBe('test-vapid-public-key');
    expect(res.headers['cache-control']).toBe('public, max-age=86400');
  });

  it('requires auth for subscribe/unsubscribe/test', async () => {
    const sub = await request(ctx.app)
      .post('/api/v1/push/subscriptions')
      .set(FETCH_HEADER)
      .send({ endpoint: 'https://push.example.com/no-auth', keys: { p256dh: 'a', auth: 'b' } });
    expect(sub.status).toBe(401);
  });

  it('subscribe: 201 for a new endpoint, 200 (idempotent) resubscribing as the same user', async () => {
    const agent = await registerAgent(ctx.app, 'subscriber@example.com');
    const endpoint = 'https://push.example.com/sub-idempotent/abc';

    const first = await agent
      .post('/api/v1/push/subscriptions')
      .set(FETCH_HEADER)
      .send({ endpoint, keys: { p256dh: 'p1', auth: 'a1' } });
    expect(first.status).toBe(201);
    const { id } = pushSubscribeResponseSchema.parse(first.body);

    const second = await agent
      .post('/api/v1/push/subscriptions')
      .set(FETCH_HEADER)
      .send({ endpoint, keys: { p256dh: 'p2', auth: 'a2' } });
    expect(second.status).toBe(200);
    expect(pushSubscribeResponseSchema.parse(second.body).id).toBe(id);
  });

  it('subscribe: re-assigns an existing endpoint to the new subscriber (200)', async () => {
    const owner = await registerAgent(ctx.app, 'first-owner@example.com');
    const endpoint = 'https://push.example.com/reassign/xyz';
    await owner
      .post('/api/v1/push/subscriptions')
      .set(FETCH_HEADER)
      .send({ endpoint, keys: { p256dh: 'p1', auth: 'a1' } });

    const newOwner = await registerAgent(ctx.app, 'second-owner@example.com');
    const res = await newOwner
      .post('/api/v1/push/subscriptions')
      .set(FETCH_HEADER)
      .send({ endpoint, keys: { p256dh: 'p2', auth: 'a2' } });
    expect(res.status).toBe(200);

    const row = await one<{ user_id: string; endpoint: string }>(
      ctx.pool,
      `SELECT user_id, endpoint FROM push_subscriptions WHERE endpoint = $1`,
      [endpoint],
    );
    const newOwnerMe = await newOwner.get('/api/v1/auth/me');
    expect(row.user_id).toBe(newOwnerMe.body.user.id);
  });

  it('unsubscribe: 204, and the row is gone', async () => {
    const agent = await registerAgent(ctx.app, 'unsubscriber@example.com');
    const endpoint = 'https://push.example.com/unsub/def';
    await agent
      .post('/api/v1/push/subscriptions')
      .set(FETCH_HEADER)
      .send({ endpoint, keys: { p256dh: 'p1', auth: 'a1' } });

    const del = await agent
      .delete('/api/v1/push/subscriptions')
      .set(FETCH_HEADER)
      .send({ endpoint });
    expect(del.status).toBe(204);

    const remaining = await ctx.pool.query('SELECT 1 FROM push_subscriptions WHERE endpoint = $1', [
      endpoint,
    ]);
    expect(remaining.rowCount).toBe(0);
  });

  it('test: sends to every subscription and reports the delivered count', async () => {
    const agent = await registerAgent(ctx.app, 'tester@example.com');
    const endpointA = 'https://push.example.com/test-a/1';
    const endpointB = 'https://push.example.com/test-b/2';
    await agent
      .post('/api/v1/push/subscriptions')
      .set(FETCH_HEADER)
      .send({ endpoint: endpointA, keys: { p256dh: 'p1', auth: 'a1' } });
    await agent
      .post('/api/v1/push/subscriptions')
      .set(FETCH_HEADER)
      .send({ endpoint: endpointB, keys: { p256dh: 'p2', auth: 'a2' } });

    const before = calls.length;
    const res = await agent.post('/api/v1/push/test').set(FETCH_HEADER);
    expect(res.status).toBe(202);
    expect(pushTestResponseSchema.parse(res.body).sent).toBe(2);
    expect(calls.length).toBe(before + 2);
    const newCalls = calls.slice(before);
    expect(newCalls.map((c) => c.endpoint).sort()).toEqual([endpointA, endpointB].sort());
    expect(newCalls[0]?.payload.title).toBeTruthy();
  });

  it('test: a 404/410 response deletes the subscription', async () => {
    const agent = await registerAgent(ctx.app, 'gone-user@example.com');
    const endpoint = 'https://push.example.com/gone-410/1';
    await agent
      .post('/api/v1/push/subscriptions')
      .set(FETCH_HEADER)
      .send({ endpoint, keys: { p256dh: 'p1', auth: 'a1' } });

    const res = await agent.post('/api/v1/push/test').set(FETCH_HEADER);
    expect(pushTestResponseSchema.parse(res.body).sent).toBe(0);

    const remaining = await ctx.pool.query('SELECT 1 FROM push_subscriptions WHERE endpoint = $1', [
      endpoint,
    ]);
    expect(remaining.rowCount).toBe(0);
  });

  it('test: 5 consecutive other-error responses delete the subscription', async () => {
    const agent = await registerAgent(ctx.app, 'flaky-user@example.com');
    const endpoint = 'https://push.example.com/always-fails/1';
    await agent
      .post('/api/v1/push/subscriptions')
      .set(FETCH_HEADER)
      .send({ endpoint, keys: { p256dh: 'p1', auth: 'a1' } });

    for (let i = 0; i < 4; i++) {
      // eslint-disable-next-line no-await-in-loop
      await agent.post('/api/v1/push/test').set(FETCH_HEADER);
      // eslint-disable-next-line no-await-in-loop
      const row = await one<{ failed_count: number }>(
        ctx.pool,
        `SELECT failed_count FROM push_subscriptions WHERE endpoint = $1`,
        [endpoint],
      );
      expect(row.failed_count).toBe(i + 1);
    }

    // 5th failure: deleted.
    await agent.post('/api/v1/push/test').set(FETCH_HEADER);
    const remaining = await ctx.pool.query('SELECT 1 FROM push_subscriptions WHERE endpoint = $1', [
      endpoint,
    ]);
    expect(remaining.rowCount).toBe(0);
  });
});
