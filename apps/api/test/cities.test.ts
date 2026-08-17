import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import {
  cityListResponseSchema,
  stationListResponseSchema,
  mapResponseSchema,
} from '@dockcast/shared';
import { setupTestApp, type TestContext } from './helpers/testApp.js';

describe('GET /cities, /cities/:slug/stations, /cities/:slug/map', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await setupTestApp();
  }, 60_000);

  afterAll(async () => {
    await ctx.teardown();
  });

  describe('GET /cities', () => {
    it('200s with toronto and ottawa, schema-valid', async () => {
      const res = await request(ctx.app).get('/api/v1/cities');
      expect(res.status).toBe(200);
      const body = cityListResponseSchema.parse(res.body);
      const slugs = body.cities.map((c) => c.slug);
      expect(slugs).toContain('toronto');
      expect(slugs).toContain('ottawa');
      const toronto = body.cities.find((c) => c.slug === 'toronto');
      expect(toronto?.forecasting_enabled).toBe(true);
      expect(toronto?.station_count).toBeGreaterThan(50);
      expect(toronto?.last_status_ok_at).not.toBeNull();
    });

    it('sets Cache-Control: public, max-age=300', async () => {
      const res = await request(ctx.app).get('/api/v1/cities');
      expect(res.headers['cache-control']).toBe('public, max-age=300');
    });
  });

  describe('GET /cities/:slug/stations', () => {
    it('200s with active stations, schema-valid', async () => {
      const res = await request(ctx.app).get('/api/v1/cities/toronto/stations');
      expect(res.status).toBe(200);
      const body = stationListResponseSchema.parse(res.body);
      expect(body.stations.length).toBeGreaterThan(50);
      const ids = body.stations.map((s) => s.id);
      expect(ids).toContain(ctx.seeded.hub.id);
    });

    it('sets Cache-Control: public, max-age=3600', async () => {
      const res = await request(ctx.app).get('/api/v1/cities/toronto/stations');
      expect(res.headers['cache-control']).toBe('public, max-age=3600');
    });

    it('404s for an unknown city slug', async () => {
      const res = await request(ctx.app).get('/api/v1/cities/nope/stations');
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('not_found');
    });
  });

  describe('GET /cities/:slug/map', () => {
    it('200s, schema-valid, t0 non-null, hub station has 6 non-null forecast entries', async () => {
      const res = await request(ctx.app).get('/api/v1/cities/toronto/map');
      expect(res.status).toBe(200);
      const body = mapResponseSchema.parse(res.body);
      expect(body.t0).not.toBeNull();
      expect(body.horizons).toEqual([15, 30, 45, 60, 90, 120]);

      const hub = body.stations.find((s) => s.id === ctx.seeded.hub.id);
      expect(hub).toBeDefined();
      expect(hub?.fresh).toBe(true);
      expect(hub?.f).toHaveLength(6);
      expect(hub?.f.every((entry) => entry !== null)).toBe(true);
      expect(hub?.f[0]).toEqual([0.95, 0.9, 4]);

      const unavailable = body.stations.find((s) => s.id === ctx.seeded.unavailableStation.id);
      expect(unavailable?.f.every((entry) => entry === null)).toBe(true);

      const stale = body.stations.find((s) => s.id === ctx.seeded.staleCurrentStation.id);
      expect(stale?.fresh).toBe(false);
    });

    it('omits stations without a station_current row', async () => {
      // every seeded station has station_current, so the count should equal active-station count
      const mapRes = await request(ctx.app).get('/api/v1/cities/toronto/map');
      const stationsRes = await request(ctx.app).get('/api/v1/cities/toronto/stations');
      expect(mapRes.body.stations.length).toBe(stationsRes.body.stations.length);
    });

    it('sets Cache-Control: public, max-age=30', async () => {
      const res = await request(ctx.app).get('/api/v1/cities/toronto/map');
      expect(res.headers['cache-control']).toBe('public, max-age=30');
    });

    it('404s for an unknown city slug', async () => {
      const res = await request(ctx.app).get('/api/v1/cities/nope/map');
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('not_found');
    });
  });
});
