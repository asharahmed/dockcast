import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { modelResponseSchema, modelVersionDetailResponseSchema } from '@dockcast/shared';
import { setupTestApp, type TestContext } from './helpers/testApp.js';

type TestAgent = ReturnType<typeof request.agent>;

const ADMIN_EMAIL = 'operator@example.com';
const PASSWORD = 'correct-horse-battery';

/** A supertest agent whose cookie jar holds a session for `email` (registers it on first use). */
async function signedInAgent(ctx: TestContext, email: string): Promise<TestAgent> {
  const agent = request.agent(ctx.app);
  const res = await agent
    .post('/api/v1/auth/register')
    .set('X-Requested-With', 'fetch')
    .send({ email, password: PASSWORD });
  expect(res.status).toBe(201);
  return agent;
}

describe('GET /model, GET /model/versions/:id', () => {
  let ctx: TestContext;
  let admin: TestAgent;
  let member: TestAgent;

  beforeAll(async () => {
    ctx = await setupTestApp({ ADMIN_EMAILS: ` ${ADMIN_EMAIL.toUpperCase()} ,` });
    admin = await signedInAgent(ctx, ADMIN_EMAIL);
    member = await signedInAgent(ctx, 'member@example.com');
  }, 60_000);

  afterAll(async () => {
    await ctx.teardown();
  });

  describe('GET /model?city=toronto (operator view)', () => {
    it('200s, schema-valid, reflects seeded model/metrics/worker data', async () => {
      const res = await admin.get('/api/v1/model').query({ city: 'toronto' });
      expect(res.status).toBe(200);
      const body = modelResponseSchema.parse(res.body);
      expect(body.viewer.is_admin).toBe(true);

      expect(body.city.slug).toBe('toronto');
      expect(body.data_since).not.toBeNull();
      expect(body.n_stations_active).toBeGreaterThan(50);

      expect(body.collector.last_ok_at).not.toBeNull();
      // Seed: one ok poll per minute for the 24 h before FIXED_NOW; the collector is younger than
      // 7 d, so it is scored against those 24 h (all ok) → 100% (capped).
      expect(body.collector.uptime_7d_pct).toBe(100);

      expect(body.predictor.last_run_at).not.toBeNull();
      expect(body.predictor.serving_tier).toBe('bd_raw');

      expect(body.active.gbm?.id).toBe(ctx.seeded.modelVersionGbmId);
      expect(body.active.gbm?.status).toBe('active');
      expect(body.active.gbm?.metrics_val?.ref.tier).toBe('bd_raw');
      expect(body.active.bd?.id).toBe(ctx.seeded.modelVersionBdId);
      expect(body.active.bd?.metrics_val?.ref.tier).toBeNull();

      expect(body.metrics.length).toBeGreaterThan(0);
      expect(body.metrics.every((m) => m.day === '2026-03-09')).toBe(true);
      // The operator view keeps every scored tier, including ones the public view drops.
      expect(body.metrics.some((m) => m.tier === 'gbm_active')).toBe(true);

      const versionIds = body.versions.map((v) => v.id);
      expect(versionIds).toContain(ctx.seeded.modelVersionGbmId);
      expect(versionIds).toContain(ctx.seeded.modelVersionBdId);
    });

    it('is private and uncacheable, and varies on the cookie', async () => {
      const res = await admin.get('/api/v1/model').query({ city: 'toronto' });
      expect(res.headers['cache-control']).toBe('private, no-store');
      expect(res.headers['vary']).toMatch(/Cookie/);
    });
  });

  describe('GET /model?city=toronto (public view)', () => {
    for (const [who, get] of [
      ['anonymous', () => request(ctx.app).get('/api/v1/model')],
      ['a signed-in non-admin', () => member.get('/api/v1/model')],
    ] as const) {
      it(`${who}: serving tier + persistence metrics only, no versions, no gate detail`, async () => {
        const res = await get().query({ city: 'toronto' });
        expect(res.status).toBe(200);
        const body = modelResponseSchema.parse(res.body);
        expect(body.viewer.is_admin).toBe(false);

        // Seeded serving tier is bd_raw: only its rows and the persistence baseline may appear
        // (the seed scores gbm_active and persistence, so persistence is what is left).
        expect(body.predictor.serving_tier).toBe('bd_raw');
        expect(body.metrics.length).toBeGreaterThan(0);
        const tiers = new Set(body.metrics.map((m) => m.tier));
        expect([...tiers].every((t) => t === 'bd_raw' || t === 'persistence')).toBe(true);

        expect(body.versions).toEqual([]);
        expect(body.active.gbm?.id).toBe(ctx.seeded.modelVersionGbmId);
        expect(body.active.gbm?.metrics_val).toBeNull();
        expect(body.active.gbm?.gate).toBeNull();
        expect(body.active.bd?.metrics_val).toBeNull();
      });
    }

    it('sets Cache-Control: public, max-age=300 and varies on the cookie', async () => {
      const res = await request(ctx.app).get('/api/v1/model').query({ city: 'toronto' });
      expect(res.headers['cache-control']).toBe('public, max-age=300');
      expect(res.headers['vary']).toMatch(/Cookie/);
    });

    it('empty-metrics city (ottawa): metrics=[], active tiers null, nullable fields null', async () => {
      const res = await request(ctx.app).get('/api/v1/model').query({ city: 'ottawa' });
      expect(res.status).toBe(200);
      const body = modelResponseSchema.parse(res.body);

      expect(body.city.slug).toBe('ottawa');
      expect(body.data_since).toBeNull();
      expect(body.n_stations_active).toBe(1);
      expect(body.collector.uptime_7d_pct).toBeNull();
      expect(body.predictor.last_run_at).toBeNull();
      expect(body.predictor.serving_tier).toBe('none');
      expect(body.active.gbm).toBeNull();
      expect(body.active.bd).toBeNull();
      expect(body.metrics).toEqual([]);
      expect(body.versions).toEqual([]);
    });

    it('400s when city is missing', async () => {
      const res = await request(ctx.app).get('/api/v1/model');
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('validation_error');
    });

    it('404s for an unknown city', async () => {
      const res = await request(ctx.app).get('/api/v1/model').query({ city: 'nope' });
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('not_found');
    });
  });

  describe('GET /model/versions/:id', () => {
    it('200s with version + eval rows, schema-valid (operator)', async () => {
      const res = await admin.get(`/api/v1/model/versions/${ctx.seeded.modelVersionGbmId}`);
      expect(res.status).toBe(200);
      const body = modelVersionDetailResponseSchema.parse(res.body);
      expect(body.version.id).toBe(ctx.seeded.modelVersionGbmId);
      expect(body.eval).toHaveLength(4);
      expect(body.eval).toContainEqual({
        tier: 'gbm',
        split: 'val',
        target: 'bike',
        horizon: 0,
        slice: 'all',
        metric: 'brier',
        value: 0.12,
      });
    });

    it('is private and uncacheable', async () => {
      const res = await admin.get(`/api/v1/model/versions/${ctx.seeded.modelVersionGbmId}`);
      expect(res.headers['cache-control']).toBe('private, no-store');
    });

    it('404s for an unknown version id', async () => {
      const res = await admin.get('/api/v1/model/versions/999999999');
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('not_found');
    });

    it('404s for anyone who is not an operator, even for a real id', async () => {
      for (const get of [
        () => request(ctx.app).get(`/api/v1/model/versions/${ctx.seeded.modelVersionGbmId}`),
        () => member.get(`/api/v1/model/versions/${ctx.seeded.modelVersionGbmId}`),
      ]) {
        const res = await get();
        expect(res.status).toBe(404);
        expect(res.body.error.code).toBe('not_found');
      }
    });
  });
});

/**
 * Regression for the fault behind "No scored forecasts yet" on /model, Sep 13-18 2026:
 * the trainer was OOM-killed between the 1-day and 7-day passes of `metrics_online`
 * every night, so the newest `day` in `model_metrics_daily` had 1-day rows only and a
 * global `max(day)` hid every 7-day row from the page.
 */
describe('GET /model — windows fall back to their own latest day', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await setupTestApp({ ADMIN_EMAILS: ADMIN_EMAIL });
    // A newer day for the 1-day window only, as a run that died mid-`compute` leaves behind.
    await ctx.pool.query(
      `INSERT INTO model_metrics_daily (city_id, day, window_days, tier, target, horizon, slice, metric, value, n)
       SELECT id, '2026-03-10', 1, 'gbm_active', 'bike', 0, 'all', 'brier', 0.11, 5100
       FROM cities WHERE slug = 'toronto'`,
    );
  }, 60_000);

  afterAll(async () => {
    await ctx.teardown();
  });

  it('serves the newest 1-day rows and still serves the older 7-day rows', async () => {
    const admin = await signedInAgent(ctx, ADMIN_EMAIL);
    const res = await admin.get('/api/v1/model').query({ city: 'toronto' });
    expect(res.status).toBe(200);
    const body = modelResponseSchema.parse(res.body);

    const w1 = body.metrics.filter((m) => m.window_days === 1);
    const w7 = body.metrics.filter((m) => m.window_days === 7);

    expect(w1.length).toBeGreaterThan(0);
    expect(w1.every((m) => m.day === '2026-03-10')).toBe(true);
    expect(w7.length).toBeGreaterThan(0);
    expect(w7.every((m) => m.day === '2026-03-09')).toBe(true);
  });
});
