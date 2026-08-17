import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import pino from 'pino';
import { createPool } from '@dockcast/db';
import { healthResponseSchema } from '@dockcast/shared';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { setupTestApp, type TestContext } from './helpers/testApp.js';

describe('GET /health', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await setupTestApp();
  }, 60_000);

  afterAll(async () => {
    await ctx.teardown();
  });

  it('200s with ok:true, db:true, and reflects seeded collector/predictor state', async () => {
    const res = await request(ctx.app).get('/api/v1/health');
    expect(res.status).toBe(200);
    const body = healthResponseSchema.parse(res.body);
    expect(body.ok).toBe(true);
    expect(body.db).toBe(true);
    expect(body.collector_last_ok_at).not.toBeNull();
    expect(body.predictor_last_run_at).not.toBeNull();
  });

  it('sets Cache-Control: no-store', async () => {
    const res = await request(ctx.app).get('/api/v1/health');
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('echoes an inbound X-Request-Id', async () => {
    const res = await request(ctx.app)
      .get('/api/v1/health')
      .set('X-Request-Id', 'req-echo-test-123');
    expect(res.headers['x-request-id']).toBe('req-echo-test-123');
  });

  it('generates an X-Request-Id when none is supplied', async () => {
    const res = await request(ctx.app).get('/api/v1/health');
    expect(res.headers['x-request-id']).toBeTruthy();
    expect(typeof res.headers['x-request-id']).toBe('string');
  });

  it('unknown /api route -> 404 not_found envelope', async () => {
    const res = await request(ctx.app).get('/api/v1/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('not_found');
  });

  it('503s with ok:false when the DB is unreachable', async () => {
    const deadPool = createPool(
      'postgres://postgres:dockcast@localhost:5432/dockcast_health_test_dead',
      {
        applicationName: 'dockcast-api-test-dead',
      },
    );
    await deadPool.end();

    const config = loadConfig({
      ...process.env,
      DATABASE_URL: 'postgres://postgres:dockcast@localhost:5432/dockcast_health_test_dead',
      PORT: '3000',
      SESSION_SECRET: 'x'.repeat(32),
      VAPID_PUBLIC_KEY: 'x',
      VAPID_PRIVATE_KEY: 'x',
      VAPID_SUBJECT: 'mailto:test@example.com',
      PUBLIC_BASE_URL: 'http://localhost:3000',
      WEB_DIST_DIR: '/nonexistent/dockcast-test-dist',
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
    });
    const app = createApp({
      pool: deadPool,
      config,
      now: () => ctx.now,
      logger: pino({ level: 'silent' }),
    });

    const res = await request(app).get('/api/v1/health');
    expect(res.status).toBe(503);
    expect(res.body.ok).toBe(false);
    expect(res.body.db).toBe(false);
  });
});
