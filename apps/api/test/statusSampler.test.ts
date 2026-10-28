import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pino from 'pino';
import { many, none, one } from '@dockcast/db';
import { sampleOnce } from '../src/status/sampler.js';
import { LatencyTracker } from '../src/status/latency.js';
import { getSampleStats } from '../src/services/status.queries.js';
import { setupTestApp, type TestContext } from './helpers/testApp.js';
import { FIXED_NOW } from './seed.js';

describe('status sampler and retention', () => {
  let ctx: TestContext;
  const logger = pino({ level: 'silent' });
  const latency = new LatencyTracker();

  beforeAll(async () => {
    ctx = await setupTestApp();
    await none(ctx.pool, `UPDATE feed_state SET last_ok_at = $1 WHERE feed = 'station_status'`, [FIXED_NOW]);
  }, 60_000);
  afterAll(async () => {
    await ctx.teardown();
  });

  const rows = () =>
    many<{ ts: Date; component: string; ok: boolean }>(
      ctx.pool,
      `SELECT ts, component, ok FROM status_samples ORDER BY ts, component`,
    );

  it('writes one row per component, truncated to the minute', async () => {
    const t = new Date('2026-03-10T13:00:42.500Z');
    expect(await sampleOnce({ pool: ctx.pool, logger, latency, now: () => t })).toBe(true);
    const r = await rows();
    expect(r.map((x) => x.component).sort()).toEqual(['database', 'forecasts', 'stations', 'website']);
    expect(new Set(r.map((x) => x.ts.toISOString()))).toEqual(new Set(['2026-03-10T13:00:00.000Z']));
    expect(r.find((x) => x.component === 'stations')!.ok).toBe(true);
  });

  it('is idempotent across concurrent instances in the same minute, and adds a row set per new minute', async () => {
    const t = new Date('2026-03-10T13:00:55Z');
    await Promise.all([1, 2, 3].map(() => sampleOnce({ pool: ctx.pool, logger, latency, now: () => t })));
    expect(await rows()).toHaveLength(4);
    await sampleOnce({ pool: ctx.pool, logger, latency, now: () => new Date('2026-03-10T13:01:05Z') });
    expect(await rows()).toHaveLength(8);
  });

  it('marks stale stations and forecasts as not ok', async () => {
    await none(ctx.pool, `UPDATE feed_state SET last_ok_at = $1 WHERE feed = 'station_status'`, [new Date('2026-03-10T10:00:00Z')]);
    await sampleOnce({ pool: ctx.pool, logger, latency, now: () => new Date('2026-03-10T13:02:00Z') });
    const r = (await rows()).filter((x) => x.ts.toISOString() === '2026-03-10T13:02:00.000Z');
    expect(Object.fromEntries(r.map((x) => [x.component, x.ok]))).toMatchObject({
      website: true, database: true, stations: false,
    });
  });

  it('writes nothing and reports false when the database cannot be read', async () => {
    const broken = { query: () => Promise.reject(new Error('boom')) } as never;
    expect(await sampleOnce({ pool: broken, logger, latency, now: () => FIXED_NOW })).toBe(false);
  });

  it('records the probe duration for the latency bucket', () => {
    expect(latency.bucket(new Date('2026-03-10T13:02:30Z').getTime())).toBe('fast');
  });

  it('counts uptime samples by window', async () => {
    await none(ctx.pool, `DELETE FROM status_samples`);
    await none(
      ctx.pool,
      `INSERT INTO status_samples (ts, component, ok)
       SELECT gs, 'website', (extract(minute FROM gs)::int % 10) <> 0
       FROM generate_series($1::timestamptz - interval '10 days', $1::timestamptz, interval '1 minute') gs`,
      [FIXED_NOW],
    );
    const s = await getSampleStats(ctx.pool, FIXED_NOW, new Date(FIXED_NOW.getTime() - 14 * 86_400_000));
    // 9 of every 10 minutes ok; 7 days = 10080 minutes (+/- boundary).
    expect(s.ok7).toBeGreaterThan(9000);
    expect(s.ok7).toBeLessThan(9200);
    expect(s.first.get('website')!.getTime()).toBe(FIXED_NOW.getTime() - 10 * 86_400_000);
  });

  describe('retention', () => {
    it('is a hypertable with a 90 day retention policy', async () => {
      const job = await one<{ drop_after: string }>(
        ctx.pool,
        `SELECT config->>'drop_after' AS drop_after FROM timescaledb_information.jobs
         WHERE proc_name = 'policy_retention' AND hypertable_name = 'status_samples'`,
      );
      expect(job.drop_after).toMatch(/^90 days$|^2160:00:00$/);
    });

    it('drops samples older than 90 days and keeps newer ones when the policy job runs', async () => {
      await none(ctx.pool, `DELETE FROM status_samples`);
      await none(
        ctx.pool,
        `INSERT INTO status_samples (ts, component, ok) VALUES
           (now() - interval '200 days', 'website', true),
           (now() - interval '60 days', 'website', true),
           (now() - interval '1 day', 'website', true)`,
      );
      const job = await one<{ job_id: number }>(
        ctx.pool,
        `SELECT job_id FROM timescaledb_information.jobs
         WHERE proc_name = 'policy_retention' AND hypertable_name = 'status_samples'`,
      );
      await none(ctx.pool, `CALL run_job($1)`, [job.job_id]);
      const left = await one<{ n: string; oldest_days: string }>(
        ctx.pool,
        `SELECT count(*) AS n, round(extract(epoch FROM now() - min(ts)) / 86400) AS oldest_days FROM status_samples`,
      );
      expect(Number(left.n)).toBe(2);
      expect(Number(left.oldest_days)).toBeLessThan(90);
    });
  });
});
