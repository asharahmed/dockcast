import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import pino from 'pino';
import { createPool, none } from '@dockcast/db';
import { TRAIN_PHASES, statusResponseSchema } from '@dockcast/shared';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { setupTestApp, type TestContext } from './helpers/testApp.js';
import { FIXED_NOW } from './seed.js';

const SECRET = 'SECRET-host-asharpc /app/dockcast_ml/train.py postgres://u:pw@db/x Traceback';

describe('GET /status', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await setupTestApp();
    const city = ctx.seeded.cityId;
    const at = (mins: number): Date => new Date(FIXED_NOW.getTime() + mins * 60_000);
    // Successful reference run yesterday: 30 min, phases every 5 min.
    const refStart = at(-24 * 60);
    const refPhases = ['labels', 'serving_profile', 'bd_calibration', 'metrics_online'].map((phase, i) => ({
      phase,
      ts: new Date(refStart.getTime() + (i + 1) * 5 * 60_000).toISOString(),
      rss_mib: 900,
      peak_rss_mib: 1000 + i * 100,
    }));
    await none(
      ctx.pool,
      `INSERT INTO worker_runs (city_id, kind, started_at, finished_at, ok, summary)
       VALUES ($1, 'train', $2, $3, true, $4::jsonb)`,
      [
        city,
        refStart,
        new Date(refStart.getTime() + 30 * 60_000),
        JSON.stringify({
          trained_for_date: '2026-03-09',
          progress: { phase: 'metrics_online', phases: refPhases, attempt: 2, max_attempts: 6, updated_at: refStart },
        }),
      ],
    );
    // A failed run whose error must never be exposed.
    await none(
      ctx.pool,
      `INSERT INTO worker_runs (city_id, kind, started_at, finished_at, ok, summary, error)
       VALUES ($1, 'train', $2, $3, false, $4::jsonb, $5)`,
      [city, at(-2 * 24 * 60), at(-2 * 24 * 60 + 3), JSON.stringify({ note: SECRET }), SECRET],
    );
    // Running now (started 8 min before FIXED_NOW, one phase done, fresh heartbeat).
    await none(
      ctx.pool,
      `INSERT INTO worker_runs (city_id, kind, started_at, summary) VALUES ($1, 'train', $2, $3::jsonb)`,
      [
        city,
        at(-8),
        JSON.stringify({
          host: SECRET,
          progress: {
            phase: 'labels',
            phases: [
              { phase: 'labels', ts: at(-3).toISOString(), rss_mib: 600, peak_rss_mib: 640 },
              { phase: SECRET, ts: at(-2).toISOString(), rss_mib: 1, peak_rss_mib: 1 },
            ],
            attempt: 3,
            max_attempts: 6,
            updated_at: at(-1).toISOString(),
          },
        }),
      ],
    );
  }, 60_000);

  afterAll(async () => {
    await ctx.teardown();
  });

  it('serves the public shape with no-store caching', async () => {
    const res = await request(ctx.app).get('/api/v1/status');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const body = statusResponseSchema.parse(res.body);
    expect(body.generated_at).toBe(FIXED_NOW.toISOString());
    expect(body.services.db.ok).toBe(true);
    expect(body.services.predict.ok).toBe(true);
    expect(body.services.collector.age_s).not.toBeNull();
  });

  it('reports the running train with percent/ETA from the last successful run', async () => {
    const body = statusResponseSchema.parse((await request(ctx.app).get('/api/v1/status')).body);
    const cur = body.train.current;
    expect(cur).not.toBeNull();
    expect(cur!.state).toBe('running');
    expect(cur!.attempt).toBe(3);
    expect(cur!.max_attempts).toBe(6);
    expect(cur!.phases.map((p) => p.phase)).toEqual(['labels']);
    expect(cur!.phase).toBe('serving_profile');
    expect(cur!.elapsed_s).toBe(8 * 60);
    // labels done at +5 min of 30 (ref offset 300 s), +3 min in phase (bound is the next reference phase, +10 min) => 8 min of 30.
    expect(cur!.percent).toBeCloseTo((8 / 30) * 100, 0);
    expect(cur!.eta_s).toBe(22 * 60);
  });

  it('lists history newest first with run facts and the joined model version', async () => {
    const body = statusResponseSchema.parse((await request(ctx.app).get('/api/v1/status')).body);
    const h = body.train.history;
    expect(h).toHaveLength(3);
    expect(h[0]!.ok).toBeNull(); // still running
    expect(h[2]!.ok).toBe(false);
    expect(h[1]).toMatchObject({ ok: true, duration_s: 1800, attempt: 2, peak_rss_mib: 1300 });
    // seeded gbm model_versions row is for 2026-03-09
    expect(h[1]!.gbm_status).toBe('active');
    expect(h[1]!.gate_passed).not.toBeNull();
    expect(h[1]!.val_brier_bike).not.toBeNull();
  });

  it('never leaks error text, host names, paths, DSNs or unknown phase names', async () => {
    const res = await request(ctx.app).get('/api/v1/status');
    const text = JSON.stringify(res.body);
    for (const needle of ['SECRET', 'asharpc', '/app/', 'postgres://', 'Traceback', 'error']) {
      expect(text).not.toContain(needle);
    }
    for (const p of res.body.train.current.phases) expect(TRAIN_PHASES).toContain(p.phase);
  });

  it('marks a quiet unfinished run stalled', async () => {
    await none(ctx.pool, `DELETE FROM worker_runs WHERE kind = 'train' AND finished_at IS NULL`);
    await none(
      ctx.pool,
      `INSERT INTO worker_runs (city_id, kind, started_at, summary) VALUES ($1, 'train', $2, $3::jsonb)`,
      [
        ctx.seeded.cityId,
        new Date(FIXED_NOW.getTime() - 60 * 60_000),
        JSON.stringify({
          progress: { phases: [], attempt: 1, max_attempts: 6, updated_at: new Date(FIXED_NOW.getTime() - 30 * 60_000).toISOString() },
        }),
      ],
    );
    const body = statusResponseSchema.parse((await request(ctx.app).get('/api/v1/status')).body);
    expect(body.train.current!.state).toBe('stalled');
    expect(body.train.current!.elapsed_s).toBe(30 * 60);
  });

  it('503s with db.ok:false when the database is unreachable', async () => {
    const url = 'postgres://postgres:dockcast@localhost:5432/dockcast_status_test_dead';
    const deadPool = createPool(url, { applicationName: 'dockcast-api-test-dead' });
    await deadPool.end();
    const config = loadConfig({
      ...process.env,
      DATABASE_URL: url,
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
    const app = createApp({ pool: deadPool, config, now: () => ctx.now, logger: pino({ level: 'silent' }) });
    const res = await request(app).get('/api/v1/status');
    expect(res.status).toBe(503);
    expect(res.body.services.db.ok).toBe(false);
    expect(res.body.train.current).toBeNull();
  });
});
