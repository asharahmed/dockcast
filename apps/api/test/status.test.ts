import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import pino from 'pino';
import { none } from '@dockcast/db';
import { statusResponseSchema, STATUS_STAGES } from '@dockcast/shared';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { setupTestApp, type TestContext } from './helpers/testApp.js';
import { bannedHits } from './helpers/bannedContent.js';
import { FIXED_NOW } from './seed.js';

const HOSTILE =
  'SECRET-host-asharpc /app/dockcast_ml/train.py postgres://u:pw@db/x Traceback bd_calibration peak_rss_mib=4096 OOM-killed';

const at = (mins: number): Date => new Date(FIXED_NOW.getTime() + mins * 60_000);

function makeApp(ctx: TestContext, now: () => Date) {
  const config = loadConfig({
    ...process.env,
    DATABASE_URL: process.env.DATABASE_URL_TEST!,
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
  return createApp({
    pool: ctx.pool,
    config,
    now,
    logger: pino({ level: 'silent' }),
    deployedAt: new Date(FIXED_NOW.getTime() - 3 * 86_400_000),
  });
}

/** Every key path in a JSON value, e.g. `models.running.percent`. */
function keyPaths(v: unknown, prefix = ''): string[] {
  if (Array.isArray(v)) return v.flatMap((x) => keyPaths(x, `${prefix.replace(/\.$/, '')}[]`));
  if (v && typeof v === 'object')
    return Object.entries(v).flatMap(([k, x]) => [`${prefix}${k}`, ...keyPaths(x, `${prefix}${k}.`)]);
  return [];
}

const ALLOWED_KEYS = new Set(
  [
    'overall', 'website', 'website.state', 'website.latency',
    'stations', 'stations.state', 'stations.updated_min_ago',
    'forecasts', 'forecasts.state', 'forecasts.updated_min_ago',
    'models', 'models.state', 'models.last_update_date', 'models.running',
    'models.running.percent', 'models.running.stage', 'models.running.eta_min',
    'database', 'database.state',
    'release', 'release.deployed_ago', 'release.deployed_ago.value', 'release.deployed_ago.unit',
    'release.uptime_7d', 'release.uptime_30d',
    'history', 'history.days', 'history.website', 'history.stations', 'history.forecasts', 'history.database',
    'model_updates', 'model_updates[]date', 'model_updates[]ok', 'model_updates[]duration_min',
  ],
);

describe('GET /status', () => {
  let ctx: TestContext;
  let now = FIXED_NOW;

  beforeAll(async () => {
    ctx = await setupTestApp();
    const city = ctx.seeded.cityId;
    await none(ctx.pool, `DELETE FROM worker_runs`);
    await none(ctx.pool, `UPDATE feed_state SET last_ok_at = $1 WHERE feed = 'station_status'`, [at(-2)]);
    await none(
      ctx.pool,
      `INSERT INTO worker_runs (city_id, kind, started_at, finished_at, ok, summary)
       VALUES ($1, 'predict', $2, $2, true, '{}'::jsonb)`,
      [city, at(-10)],
    );
    const insertTrain = (start: Date, mins: number | null, ok: boolean | null, summary: object, error: string | null = null) =>
      none(
        ctx.pool,
        `INSERT INTO worker_runs (city_id, kind, started_at, finished_at, ok, summary, error)
         VALUES ($1, 'train', $2, $3, $4, $5::jsonb, $6)`,
        [city, start, mins === null ? null : new Date(start.getTime() + mins * 60_000), ok, JSON.stringify(summary), error],
      );
    // Successful reference run yesterday: 30 min, phases every 5 min, with memory/attempt data.
    const refStart = at(-24 * 60);
    const refPhases = ['labels', 'serving_profile', 'bd_calibration', 'train_profile'].map((phase, i) => ({
      phase,
      ts: new Date(refStart.getTime() + (i + 1) * 5 * 60_000).toISOString(),
      rss_mib: 900,
      peak_rss_mib: 5600,
    }));
    await insertTrain(refStart, 30, true, {
      progress: { phases: refPhases, attempt: 2, max_attempts: 6, updated_at: refStart.toISOString() },
    });
    // Two days ago: a failed attempt, then a retry that succeeded the same UTC day.
    const d2 = at(-2 * 24 * 60);
    await insertTrain(d2, 3, false, { note: HOSTILE }, HOSTILE);
    await insertTrain(new Date(d2.getTime() + 60 * 60_000), 41, true, {});
    // Three days ago: an attempt that died without finishing.
    await insertTrain(at(-3 * 24 * 60), null, null, { progress: { attempt: 1 } });
    // Running now (8 min in, labels done, fresh heartbeat), with hostile content in every free-text spot.
    await insertTrain(at(-8), null, null, {
      host: HOSTILE,
      progress: {
        phases: [
          { phase: 'labels', ts: at(-3).toISOString(), rss_mib: 600, peak_rss_mib: 4096 },
          { phase: HOSTILE, ts: at(-2).toISOString(), rss_mib: 1, peak_rss_mib: 1 },
        ],
        attempt: 3,
        max_attempts: 6,
        updated_at: at(-1).toISOString(),
      },
    });
    // Two days of per-minute samples for every component.
    await none(
      ctx.pool,
      `INSERT INTO status_samples (ts, component, ok)
       SELECT gs, c, true FROM generate_series($1::timestamptz - interval '2 days', $1::timestamptz, interval '1 minute') gs,
         unnest(ARRAY['website','stations','forecasts','database']) c`,
      [FIXED_NOW],
    );
  }, 60_000);

  afterAll(async () => {
    await ctx.teardown();
  });

  let cached: ReturnType<typeof makeApp> | undefined;
  const defaultApp = () => (cached ??= makeApp(ctx, () => FIXED_NOW));
  const get = (app = defaultApp()) => request(app).get('/api/v1/status');

  it('serves the overall status with a short public cache', async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('public, max-age=10');
    const body = statusResponseSchema.parse(res.body);
    expect(body.overall).toBe('operational');
    expect(body.stations).toEqual({ state: 'operational', updated_min_ago: 2 });
    expect(body.forecasts).toEqual({ state: 'operational', updated_min_ago: 10 });
    expect(body.database).toEqual({ state: 'operational' });
    expect(body.release.deployed_ago).toEqual({ value: 3, unit: 'days' });
    expect(body.models.last_update_date).toBe(at(-24 * 60 + 30).toISOString().slice(0, 10));
  });

  it('reports a running update as stage, whole percent and whole-minute ETA', async () => {
    const body = statusResponseSchema.parse((await get()).body);
    const run = body.models.running!;
    expect(STATUS_STAGES).toContain(run.stage);
    expect(run.stage).toBe('preparing data');
    // labels done at +5 of 30 min; 3 min into the next phase => 8/30 = 26.7% -> 27, 22 min left.
    expect(run.percent).toBe(27);
    expect(run.eta_min).toBe(22);
    expect(Number.isInteger(run.percent)).toBe(true);
  });

  it('lists model updates one row per UTC date, newest first, retries collapsed, crashes hidden', async () => {
    const body = statusResponseSchema.parse((await get()).body);
    const rows = body.model_updates;
    expect(rows.map((r) => r.date)).toEqual([...new Set(rows.map((r) => r.date))]);
    expect(rows).toHaveLength(2); // yesterday + two days ago; running and crashed rows omitted
    expect(rows[0]).toEqual({ date: at(-24 * 60).toISOString().slice(0, 10), ok: true, duration_min: 30 });
    expect(rows[1]).toEqual({ date: at(-48 * 60).toISOString().slice(0, 10), ok: true, duration_min: 41 });
  });

  it('computes uptime and the 14-day strip from samples', async () => {
    const body = statusResponseSchema.parse((await get()).body);
    // Samples cover the last 2 days with no gaps: 100% over both windows.
    expect(body.release.uptime_7d).toBe(100);
    expect(body.release.uptime_30d).toBe(100);
    expect(body.history.days).toHaveLength(14);
    expect(body.history.days.at(-1)).toBe(FIXED_NOW.toISOString().slice(0, 10));
    expect(body.history.website.slice(0, 11).every((c) => c === 'none')).toBe(true);
    expect(body.history.website.at(-1)).toBe('ok');
    expect(body.history.database.at(-2)).toBe('ok');
  });

  it('contains only allowlisted keys (schema is strict)', async () => {
    const res = await get();
    for (const k of keyPaths(res.body)) expect(ALLOWED_KEYS, `unexpected key ${k}`).toContain(k);
    // An extra key must make the schema reject, not pass.
    expect(statusResponseSchema.safeParse({ ...res.body, git_sha: 'abc1234' }).success).toBe(false);
    expect(
      statusResponseSchema.safeParse({ ...res.body, database: { state: 'operational', engine: 'x' } }).success,
    ).toBe(false);
  });

  it('contains no banned content in the body or in any response header', async () => {
    const res = await get();
    const headers = Object.entries(res.headers).map(([k, v]) => `${k}: ${String(v)}`).join('\n');
    expect(bannedHits(res.text)).toEqual([]);
    // Headers legitimately carry e.g. a request id and content-length; scan names + values for the rest.
    expect(headers).not.toMatch(/ratelimit|retry-after|x-powered-by|^server:/im);
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['server']).toBeUndefined();
    expect(res.text).not.toMatch(/SECRET|asharpc|\/app\/|postgres:\/\/|Traceback/);
  });

  it('banned-content scanner catches what it should (guards the guard)', () => {
    for (const s of ['peak 4096 MiB', 'attempt 2/6', '"git_sha":"a0e5ae7"', 'bd_calibration', '03:30', 'postgres', 'Cloudflare tunnel', 'host-1']) {
      expect(bannedHits(s), s).not.toEqual([]);
    }
    for (const s of ['operational degraded down fast slow', 'preparing data', 'training', 'evaluating', 'publishing', '2026-03-10']) {
      expect(bannedHits(s), s).toEqual([]);
    }
  });

  it('serves a fixed 503 body with no detail when the database is unreachable', async () => {
    const dead = { ...ctx, pool: { query: () => Promise.reject(new Error(HOSTILE)) } } as unknown as TestContext;
    const res = await get(makeApp(dead, () => FIXED_NOW));
    expect(res.status).toBe(503);
    const body = statusResponseSchema.parse(res.body);
    expect(body.database.state).toBe('down');
    expect(body.overall).toBe('down');
    expect(res.text).not.toMatch(/SECRET|asharpc|Traceback/);
    expect(bannedHits(res.text)).toEqual([]);
  });

  describe('single snapshot per 15 s window', () => {
    it('concurrent cache misses run one set of queries; the next window runs another', async () => {
      // Learn the cost of one snapshot on a throwaway app.
      const probe = vi.spyOn(ctx.pool, 'query');
      await get(makeApp(ctx, () => FIXED_NOW));
      const perSnapshot = probe.mock.calls.length;
      expect(perSnapshot).toBeGreaterThan(0);
      probe.mockClear();

      let clock = FIXED_NOW;
      const app = makeApp(ctx, () => clock);
      const burst = await Promise.all(Array.from({ length: 30 }, () => get(app)));
      expect(burst.every((r) => r.status === 200)).toBe(true);
      expect(probe.mock.calls.length).toBe(perSnapshot);

      clock = new Date(FIXED_NOW.getTime() + 14_000);
      await Promise.all(Array.from({ length: 10 }, () => get(app)));
      expect(probe.mock.calls.length).toBe(perSnapshot);

      clock = new Date(FIXED_NOW.getTime() + 15_000);
      await Promise.all(Array.from({ length: 10 }, () => get(app)));
      expect(probe.mock.calls.length).toBe(2 * perSnapshot);
      probe.mockRestore();
    });

    it('everyone in a window gets the identical body', async () => {
      const app = makeApp(ctx, () => FIXED_NOW);
      const [a, b] = await Promise.all([get(app), get(app)]);
      expect(a.text).toBe(b.text);
    });
  });

  describe('rate limiting', () => {
    it('answers 429 with a generic body and no limit headers, on every response', async () => {
      const app = makeApp(ctx, () => FIXED_NOW);
      const first = await get(app);
      expect(Object.keys(first.headers).filter((h) => /ratelimit|retry-after/i.test(h))).toEqual([]);
      const burst = await Promise.all(Array.from({ length: 130 }, () => get(app)));
      const limited = burst.find((r) => r.status === 429);
      expect(limited).toBeDefined();
      expect(Object.keys(limited!.headers).filter((h) => /ratelimit|retry-after/i.test(h))).toEqual([]);
      expect(limited!.text).not.toMatch(/\d{2,}/);
    });
  });
});
