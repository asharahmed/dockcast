import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { stationDetailResponseSchema, stationHistoryResponseSchema } from '@dockcast/shared';
import { setupTestApp, type TestContext } from './helpers/testApp.js';

describe('GET /stations/:id, GET /stations/:id/history', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await setupTestApp();
  }, 60_000);

  afterAll(async () => {
    await ctx.teardown();
  });

  describe('GET /stations/:id', () => {
    it('hub: full happy path, schema-valid', async () => {
      const res = await request(ctx.app).get(`/api/v1/stations/${ctx.seeded.hub.id}`);
      expect(res.status).toBe(200);
      const body = stationDetailResponseSchema.parse(res.body);

      expect(body.station.id).toBe(ctx.seeded.hub.id);
      expect(body.station.city.slug).toBe('toronto');

      expect(body.current).not.toBeNull();
      expect(body.current?.is_fresh).toBe(true);
      expect(body.current?.bikes).toBe(4);

      expect(body.forecasts).toHaveLength(6);
      expect(body.forecasts[0]).toMatchObject({
        horizon: 15,
        p_bike: 0.95,
        p_dock: 0.9,
        tier: 'bd_raw',
      });
      expect(body.forecasts[5]).toMatchObject({ horizon: 120, p_bike: 0.2, p_dock: 0.4 });

      expect(body.typical).toHaveLength(96);
      expect(body.typical[0]).toMatchObject({ bucket: 0, p_bike: 0.66, p_dock: 0.44 });

      expect(body.neighbors).toHaveLength(3);
      expect(body.neighbors.map((n) => n.id)).toEqual([
        ctx.seeded.near1.id,
        ctx.seeded.near3.id,
        ctx.seeded.near2.id,
      ]);
      expect(body.neighbors[0]?.distance_m).toBe(167);

      expect(body.history.length).toBeGreaterThan(0);
    });

    it('sets Cache-Control: public, max-age=30', async () => {
      const res = await request(ctx.app).get(`/api/v1/stations/${ctx.seeded.hub.id}`);
      expect(res.headers['cache-control']).toBe('public, max-age=30');
    });

    it('noForecastStation: forecasts is empty', async () => {
      const res = await request(ctx.app).get(`/api/v1/stations/${ctx.seeded.noForecastStation.id}`);
      expect(res.status).toBe(200);
      const body = stationDetailResponseSchema.parse(res.body);
      expect(body.forecasts).toEqual([]);
    });

    it('unavailableStation: forecast rows present but p_bike/p_dock null, reason set', async () => {
      const res = await request(ctx.app).get(
        `/api/v1/stations/${ctx.seeded.unavailableStation.id}`,
      );
      expect(res.status).toBe(200);
      const body = stationDetailResponseSchema.parse(res.body);
      expect(body.forecasts).toHaveLength(6);
      expect(body.forecasts[0]?.p_bike).toBeNull();
      expect(body.forecasts[0]?.reason).toBe('not_fresh');
    });

    it('a station without a typical profile returns typical: []', async () => {
      const res = await request(ctx.app).get(`/api/v1/stations/${ctx.seeded.near1.id}`);
      expect(res.status).toBe(200);
      const body = stationDetailResponseSchema.parse(res.body);
      expect(body.typical).toEqual([]);
    });

    it('staleCurrentStation: current.is_fresh is false', async () => {
      const res = await request(ctx.app).get(
        `/api/v1/stations/${ctx.seeded.staleCurrentStation.id}`,
      );
      expect(res.status).toBe(200);
      const body = stationDetailResponseSchema.parse(res.body);
      expect(body.current?.is_fresh).toBe(false);
    });

    it('404s for an unknown station id', async () => {
      const res = await request(ctx.app).get('/api/v1/stations/999999999');
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('not_found');
    });

    it('404s for a non-numeric station id', async () => {
      const res = await request(ctx.app).get('/api/v1/stations/not-a-number');
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('not_found');
    });
  });

  describe('GET /stations/:id/history', () => {
    it('default 24h: 289 points on a 5-min grid, correctly as-of/ffilled', async () => {
      const res = await request(ctx.app).get(`/api/v1/stations/${ctx.seeded.hub.id}/history`);
      expect(res.status).toBe(200);
      const body = stationHistoryResponseSchema.parse(res.body);
      expect(body.points).toHaveLength(289);
      expect(body.points[0]).toMatchObject({ bikes: 2, docks: 18 });
      expect(body.points[288]).toMatchObject({ bikes: 5, docks: 15 });
    });

    it('hours=1: 13 points', async () => {
      const res = await request(ctx.app)
        .get(`/api/v1/stations/${ctx.seeded.hub.id}/history`)
        .query({ hours: 1 });
      expect(res.status).toBe(200);
      const body = stationHistoryResponseSchema.parse(res.body);
      expect(body.points).toHaveLength(13);
    });

    it('sets Cache-Control: public, max-age=60', async () => {
      const res = await request(ctx.app).get(`/api/v1/stations/${ctx.seeded.hub.id}/history`);
      expect(res.headers['cache-control']).toBe('public, max-age=60');
    });

    it('400s for hours=0 (below min)', async () => {
      const res = await request(ctx.app)
        .get(`/api/v1/stations/${ctx.seeded.hub.id}/history`)
        .query({ hours: 0 });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('validation_error');
    });

    it('400s for hours=200 (above max)', async () => {
      const res = await request(ctx.app)
        .get(`/api/v1/stations/${ctx.seeded.hub.id}/history`)
        .query({ hours: 200 });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('validation_error');
    });

    it('404s for an unknown station id', async () => {
      const res = await request(ctx.app).get('/api/v1/stations/999999999/history');
      expect(res.status).toBe(404);
    });
  });
});
