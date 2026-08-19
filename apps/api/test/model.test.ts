import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { modelResponseSchema, modelVersionDetailResponseSchema } from '@dockcast/shared';
import { setupTestApp, type TestContext } from './helpers/testApp.js';

describe('GET /model, GET /model/versions/:id', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await setupTestApp();
  }, 60_000);

  afterAll(async () => {
    await ctx.teardown();
  });

  describe('GET /model?city=toronto', () => {
    it('200s, schema-valid, reflects seeded model/metrics/worker data', async () => {
      const res = await request(ctx.app).get('/api/v1/model').query({ city: 'toronto' });
      expect(res.status).toBe(200);
      const body = modelResponseSchema.parse(res.body);

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

      const versionIds = body.versions.map((v) => v.id);
      expect(versionIds).toContain(ctx.seeded.modelVersionGbmId);
      expect(versionIds).toContain(ctx.seeded.modelVersionBdId);
    });

    it('sets Cache-Control: public, max-age=300', async () => {
      const res = await request(ctx.app).get('/api/v1/model').query({ city: 'toronto' });
      expect(res.headers['cache-control']).toBe('public, max-age=300');
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
    it('200s with version + eval rows, schema-valid', async () => {
      const res = await request(ctx.app).get(
        `/api/v1/model/versions/${ctx.seeded.modelVersionGbmId}`,
      );
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

    it('sets Cache-Control: public, max-age=300', async () => {
      const res = await request(ctx.app).get(
        `/api/v1/model/versions/${ctx.seeded.modelVersionGbmId}`,
      );
      expect(res.headers['cache-control']).toBe('public, max-age=300');
    });

    it('404s for an unknown version id', async () => {
      const res = await request(ctx.app).get('/api/v1/model/versions/999999999');
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('not_found');
    });
  });
});
