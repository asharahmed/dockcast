import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { lookup } from '../src/forecast/lookup.js';
import { alternatives } from '../src/forecast/alternatives.js';
import { setupTestApp, type TestContext } from './helpers/testApp.js';

function plusMinutes(base: Date, minutes: number): Date {
  return new Date(base.getTime() + minutes * 60_000);
}

describe('lookup() — docs/api.md §0.1', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await setupTestApp();
  }, 60_000);

  afterAll(async () => {
    await ctx.teardown();
  });

  it('on-grid exact horizon match returns that row exactly', async () => {
    const result = await lookup(ctx.pool, {
      stationPk: ctx.seeded.hub.id,
      target: 'bike',
      at: plusMinutes(ctx.now, 30),
      now: ctx.now,
    });
    expect(result.kind).toBe('forecast');
    expect(result.p).toBe(0.85);
    expect(result.tier).toBe('bd_raw');
    expect(result.leadMinutes).toBe(30);
  });

  it('interpolates linearly between bracketing horizons', async () => {
    const result = await lookup(ctx.pool, {
      stationPk: ctx.seeded.hub.id,
      target: 'bike',
      at: plusMinutes(ctx.now, 22.5), // midpoint of h15 (0.95) and h30 (0.85)
      now: ctx.now,
    });
    expect(result.kind).toBe('forecast');
    expect(result.p).toBeCloseTo(0.9, 9);
  });

  it('a lead below MIN_LEAD (15) clamps up to the 15-min horizon', async () => {
    const result = await lookup(ctx.pool, {
      stationPk: ctx.seeded.hub.id,
      target: 'bike',
      at: plusMinutes(ctx.now, 5),
      now: ctx.now,
    });
    expect(result.kind).toBe('forecast');
    expect(result.p).toBe(0.95); // same as the exact h15 value
    expect(result.leadMinutes).toBe(5); // raw lead is NOT clamped in the reported value
  });

  it('a lead beyond MAX_LEAD (120) with a typical profile -> kind: typical', async () => {
    const result = await lookup(ctx.pool, {
      stationPk: ctx.seeded.hub.id,
      target: 'bike',
      at: plusMinutes(ctx.now, 200),
      now: ctx.now,
    });
    expect(result.kind).toBe('typical');
    expect(result.p).toBe(0.66);
    expect(result.tier).toBeNull();
    expect(result.exp_bikes).toBeNull();
  });

  it('a lead beyond MAX_LEAD without a typical profile -> unavailable', async () => {
    const result = await lookup(ctx.pool, {
      stationPk: ctx.seeded.near1.id,
      target: 'bike',
      at: plusMinutes(ctx.now, 200),
      now: ctx.now,
    });
    expect(result.kind).toBe('unavailable');
    expect(result.p).toBeNull();
    expect(result.reason).toBe('no_profile');
  });

  it('null p on the forecast row -> unavailable with the row reason', async () => {
    const result = await lookup(ctx.pool, {
      stationPk: ctx.seeded.unavailableStation.id,
      target: 'dock',
      at: plusMinutes(ctx.now, 30),
      now: ctx.now,
    });
    expect(result.kind).toBe('unavailable');
    expect(result.p).toBeNull();
    expect(result.reason).toBe('not_fresh');
  });

  it('a station with zero forecasts_latest rows -> unavailable (no_forecast)', async () => {
    const result = await lookup(ctx.pool, {
      stationPk: ctx.seeded.noForecastStation.id,
      target: 'bike',
      at: plusMinutes(ctx.now, 30),
      now: ctx.now,
    });
    expect(result.kind).toBe('unavailable');
    expect(result.reason).toBe('no_forecast');
  });

  it('a stale station reports current.is_fresh: false (forecast lookup itself is unaffected)', async () => {
    const result = await lookup(ctx.pool, {
      stationPk: ctx.seeded.staleCurrentStation.id,
      target: 'bike',
      at: plusMinutes(ctx.now, 30),
      now: ctx.now,
    });
    expect(result.current).not.toBeNull();
    expect(result.current?.is_fresh).toBe(false);
    expect(result.kind).toBe('forecast');
  });

  it('an unknown station -> unavailable with current: null', async () => {
    const result = await lookup(ctx.pool, {
      stationPk: 999999999,
      target: 'bike',
      at: plusMinutes(ctx.now, 30),
      now: ctx.now,
    });
    expect(result.kind).toBe('unavailable');
    expect(result.reason).toBe('unknown_station');
    expect(result.current).toBeNull();
  });
});

describe('alternatives() — docs/api.md §0.1', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await setupTestApp();
  }, 60_000);

  afterAll(async () => {
    await ctx.teardown();
  });

  it('returns active stations within ALT_RADIUS_M, sorted by p desc, top 3, excluding self', async () => {
    const results = await alternatives(ctx.pool, {
      stationPk: ctx.seeded.hub.id,
      target: 'bike',
      at: plusMinutes(ctx.now, 15),
      now: ctx.now,
    });
    expect(results.map((r) => r.station.id)).toEqual([
      ctx.seeded.near2.id,
      ctx.seeded.near3.id,
      ctx.seeded.near1.id,
    ]);
    expect(results.map((r) => r.p)).toEqual([0.9, 0.7, 0.5]);
    expect(results.every((r) => r.station.id !== ctx.seeded.hub.id)).toBe(true);
    expect(results.every((r) => r.station.id !== ctx.seeded.far1.id)).toBe(true);
  });
});
