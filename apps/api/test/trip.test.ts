import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { tripResponseSchema } from '@dockcast/shared';
import { setupTestApp, type TestContext } from './helpers/testApp.js';

function isoPlusMinutes(base: Date, minutes: number): string {
  return new Date(base.getTime() + minutes * 60_000).toISOString();
}

describe('GET /trip', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await setupTestApp();
  }, 60_000);

  afterAll(async () => {
    await ctx.teardown();
  });

  it('default depart_at (now) and default ride_minutes: both legs clamp to the 15-min horizon, verdict good', async () => {
    const res = await request(ctx.app)
      .get('/api/v1/trip')
      .query({ origin: ctx.seeded.hub.id, dest: ctx.seeded.near1.id });
    expect(res.status).toBe(200);
    const body = tripResponseSchema.parse(res.body);

    expect(body.depart_at).toBe(ctx.now.toISOString());
    expect(body.ride_minutes).toBe(5); // ~167m apart -> max(5, round(0.167/12*60+3)) = 5
    expect(body.arrive_at).toBe(isoPlusMinutes(ctx.now, 5));

    expect(body.origin.kind).toBe('forecast');
    expect(body.origin.p).toBe(0.95); // lead 0 clamps to MIN_LEAD=15 -> hub h15
    expect(body.dest.kind).toBe('forecast');
    expect(body.dest.p).toBe(0.95); // lead 5 clamps to 15 -> near1 p_dock h15
    expect(body.verdict).toBe('good');
  });

  it('a past depart_at is treated as now', async () => {
    const res = await request(ctx.app)
      .get('/api/v1/trip')
      .query({
        origin: ctx.seeded.hub.id,
        dest: ctx.seeded.near1.id,
        depart_at: isoPlusMinutes(ctx.now, -60),
      });
    expect(res.status).toBe(200);
    expect(res.body.depart_at).toBe(ctx.now.toISOString());
  });

  it('risky verdict at exact horizons 45/60', async () => {
    const res = await request(ctx.app)
      .get('/api/v1/trip')
      .query({
        origin: ctx.seeded.hub.id,
        dest: ctx.seeded.near1.id,
        depart_at: isoPlusMinutes(ctx.now, 45),
        ride_minutes: 15,
      });
    expect(res.status).toBe(200);
    const body = tripResponseSchema.parse(res.body);
    expect(body.origin.p).toBe(0.6); // hub h45
    expect(body.dest.p).toBe(0.6); // near1 p_dock h60
    expect(body.verdict).toBe('risky');
  });

  it('bad verdict at exact horizons 90/120', async () => {
    const res = await request(ctx.app)
      .get('/api/v1/trip')
      .query({
        origin: ctx.seeded.hub.id,
        dest: ctx.seeded.near1.id,
        depart_at: isoPlusMinutes(ctx.now, 90),
        ride_minutes: 30,
      });
    expect(res.status).toBe(200);
    const body = tripResponseSchema.parse(res.body);
    expect(body.origin.p).toBe(0.3); // hub h90
    expect(body.dest.p).toBe(0.1); // near1 p_dock h120
    expect(body.verdict).toBe('bad');
  });

  it('beyond 120 min: origin (has a profile) -> typical, dest (no profile) -> unavailable, verdict unknown', async () => {
    const res = await request(ctx.app)
      .get('/api/v1/trip')
      .query({
        origin: ctx.seeded.hub.id,
        dest: ctx.seeded.near1.id,
        depart_at: isoPlusMinutes(ctx.now, 200),
        ride_minutes: 1,
      });
    expect(res.status).toBe(200);
    const body = tripResponseSchema.parse(res.body);
    expect(body.origin.kind).toBe('typical');
    expect(body.origin.p).toBe(0.66);
    expect(body.origin.tier).toBeNull();
    expect(body.dest.kind).toBe('unavailable');
    expect(body.dest.reason).toBe('no_profile');
    expect(body.verdict).toBe('unknown');
  });

  it('null p_dock on the forecast row -> unavailable, verdict unknown', async () => {
    const res = await request(ctx.app)
      .get('/api/v1/trip')
      .query({
        origin: ctx.seeded.hub.id,
        dest: ctx.seeded.unavailableStation.id,
        depart_at: isoPlusMinutes(ctx.now, 30),
        ride_minutes: 15,
      });
    expect(res.status).toBe(200);
    const body = tripResponseSchema.parse(res.body);
    expect(body.origin.kind).toBe('forecast');
    expect(body.dest.kind).toBe('unavailable');
    expect(body.dest.p).toBeNull();
    expect(body.dest.reason).toBe('not_fresh');
    expect(body.verdict).toBe('unknown');
  });

  it('stale station: current.is_fresh is false even though the forecast itself is available', async () => {
    const res = await request(ctx.app)
      .get('/api/v1/trip')
      .query({
        origin: ctx.seeded.hub.id,
        dest: ctx.seeded.staleCurrentStation.id,
        depart_at: isoPlusMinutes(ctx.now, 30),
        ride_minutes: 1,
      });
    expect(res.status).toBe(200);
    const body = tripResponseSchema.parse(res.body);
    expect(body.dest.kind).toBe('forecast');
    expect(body.dest.p).toBe(0.5);
    expect(body.dest.current?.is_fresh).toBe(false);
  });

  it('alternatives: radius, ordering by p desc, top 3, excludes self and out-of-radius stations', async () => {
    const res = await request(ctx.app)
      .get('/api/v1/trip')
      .query({
        origin: ctx.seeded.hub.id,
        dest: ctx.seeded.near1.id,
        depart_at: isoPlusMinutes(ctx.now, 15),
        ride_minutes: 5,
      });
    expect(res.status).toBe(200);
    const body = tripResponseSchema.parse(res.body);
    const altIds = body.origin.alternatives.map((a) => a.station.id);
    expect(altIds).toEqual([ctx.seeded.near2.id, ctx.seeded.near3.id, ctx.seeded.near1.id]);
    expect(altIds).not.toContain(ctx.seeded.hub.id);
    expect(altIds).not.toContain(ctx.seeded.far1.id);
    expect(body.origin.alternatives.map((a) => a.p)).toEqual([0.9, 0.7, 0.5]);
  });

  it('400s when origin and dest are the same station', async () => {
    const res = await request(ctx.app)
      .get('/api/v1/trip')
      .query({ origin: ctx.seeded.hub.id, dest: ctx.seeded.hub.id });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_error');
  });

  it('400s when origin and dest are in different cities', async () => {
    const res = await request(ctx.app)
      .get('/api/v1/trip')
      .query({ origin: ctx.seeded.hub.id, dest: ctx.seeded.otherCityStation.id });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_error');
  });

  it('404s for an unknown origin/dest station', async () => {
    const res = await request(ctx.app)
      .get('/api/v1/trip')
      .query({ origin: 999999999, dest: ctx.seeded.near1.id });
    expect(res.status).toBe(404);
  });

  it('400s on missing required query params', async () => {
    const res = await request(ctx.app).get('/api/v1/trip').query({ origin: ctx.seeded.hub.id });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_error');
  });

  it('sets Cache-Control: no-store', async () => {
    const res = await request(ctx.app)
      .get('/api/v1/trip')
      .query({ origin: ctx.seeded.hub.id, dest: ctx.seeded.near1.id });
    expect(res.headers['cache-control']).toBe('no-store');
  });
});

describe('GET /trip rate limiting (isolated app instance)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await setupTestApp();
  }, 60_000);

  afterAll(async () => {
    await ctx.teardown();
  });

  it('429s after 60 requests/min/IP', async () => {
    let last: { status: number; body: unknown } = { status: 0, body: null };
    for (let i = 0; i < 61; i++) {
      // eslint-disable-next-line no-await-in-loop
      last = await request(ctx.app)
        .get('/api/v1/trip')
        .query({ origin: ctx.seeded.hub.id, dest: ctx.seeded.near1.id });
    }
    expect(last.status).toBe(429);
    expect((last.body as { error: { code: string } }).error.code).toBe('rate_limited');
  }, 30_000);
});
