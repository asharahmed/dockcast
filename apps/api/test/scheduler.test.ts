/**
 * `docs/api.md` §8 — alert scheduler `tick()`. Exercised directly (no
 * timers, no HTTP) against a fixed injected clock, mirroring the fixture
 * pattern of `lookup.test.ts`.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pino from 'pino';
import { many } from '@dockcast/db';
import { tick, type SchedulerDeps } from '../src/alerts/scheduler.js';
import { composeAlertBody } from '../src/alerts/compose.js';
import { lookup } from '../src/forecast/lookup.js';
import { alternatives } from '../src/forecast/alternatives.js';
import type { PushTransport } from '../src/alerts/sender.js';
import { insertUser, insertCommute, insertPushSubscription } from './seed.js';
import { setupTestApp, type TestContext } from './helpers/testApp.js';

interface Call {
  endpoint: string;
  payload: { title: string; body: string; url: string; tag: string };
}

function makeTransport(): { transport: PushTransport; calls: Call[] } {
  const calls: Call[] = [];
  const transport: PushTransport = async (subscription, payload) => {
    calls.push({ endpoint: subscription.endpoint, payload: JSON.parse(payload) });
    if (subscription.endpoint.includes('gone-410')) return { statusCode: 410 };
    if (subscription.endpoint.includes('always-fails')) return { statusCode: 500 };
    return { statusCode: 201 };
  };
  return { transport, calls };
}

// Commute: depart 08:15 local, alert_lead_minutes 20 -> due when now_local == 07:55.
// 2026-03-10 is EDT (UTC-4): 07:55 local == 11:55Z, 08:15 local == 12:15Z.
const NOW = new Date('2026-03-10T11:55:00.000Z');
const DEPART_AT = new Date('2026-03-10T12:15:00.000Z');
const TODAY_DOW = 1; // Tuesday, 0=Mon..6=Sun

describe('alert scheduler tick()', () => {
  let ctx: TestContext;
  let calls: Call[];
  let deps: SchedulerDeps;

  beforeAll(async () => {
    ctx = await setupTestApp();
    const made = makeTransport();
    calls = made.calls;
    deps = { pool: ctx.pool, logger: pino({ level: 'silent' }), pushTransport: made.transport };
  }, 60_000);

  afterAll(async () => {
    await ctx.teardown();
  });

  it('sends exactly one alert with the expected body/url/tag, records alert_events, and dedupes a second tick in the same minute', async () => {
    const user = await insertUser(ctx.pool, { email: 'main-scenario@example.com' });
    const endpoint = 'https://push.example.com/main-scenario/1';
    await insertPushSubscription(ctx.pool, { userId: user.id, endpoint });
    const commute = await insertCommute(ctx.pool, {
      userId: user.id,
      cityId: ctx.seeded.cityId,
      originStationPk: ctx.seeded.near1.id, // p_bike lead 20 ~ 0.517, below default threshold 0.7
      destStationPk: ctx.seeded.hub.id, // p_dock h30 (lead 30 exactly) = 0.8, at/above threshold
      departLocalTime: '08:15',
      rideMinutes: 10,
      daysOfWeek: [TODAY_DOW],
      alertLeadMinutes: 20,
      threshold: 0.7,
    });

    // Ground truth computed the same way scheduler.ts does, via the already
    // independently-tested lookup()/alternatives() functions.
    const originLookup = await lookup(ctx.pool, {
      stationPk: ctx.seeded.near1.id,
      target: 'bike',
      at: DEPART_AT,
      now: NOW,
    });
    expect(originLookup.kind).toBe('forecast');
    expect(originLookup.p).not.toBeNull();
    expect(originLookup.p as number).toBeLessThan(0.7);
    const originAlternatives = await alternatives(ctx.pool, {
      stationPk: ctx.seeded.near1.id,
      target: 'bike',
      at: DEPART_AT,
      now: NOW,
    });
    const expectedBody = composeAlertBody({
      kind: 'origin_low',
      tzName: ctx.seeded.cityTz,
      origin: {
        stationName: ctx.seeded.near1.name,
        p: originLookup.p as number,
        at: DEPART_AT,
        alternatives: originAlternatives,
      },
    });
    const expectedUrl = `/trip?from=${ctx.seeded.near1.id}&to=${ctx.seeded.hub.id}&at=${encodeURIComponent(DEPART_AT.toISOString())}&ride=10`;

    await tick(deps, NOW);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.endpoint).toBe(endpoint);
    expect(calls[0]?.payload.body).toBe(expectedBody);
    expect(calls[0]?.payload.url).toBe(expectedUrl);
    expect(calls[0]?.payload.tag).toBe(commute.id);

    const events = await many<{ kind: string; delivered: number; local_date: string }>(
      ctx.pool,
      `SELECT kind, delivered, local_date::text FROM alert_events WHERE commute_id = $1`,
      [commute.id],
    );
    expect(events).toHaveLength(1);
    expect(events[0]?.kind).toBe('origin_low');
    expect(events[0]?.delivered).toBe(1);
    expect(events[0]?.local_date).toBe('2026-03-10');

    // Second tick, same minute: no duplicate send, no duplicate alert_events row.
    await tick(deps, NOW);
    expect(calls).toHaveLength(1);
    const eventsAfterSecondTick = await many(
      ctx.pool,
      `SELECT 1 FROM alert_events WHERE commute_id = $1`,
      [commute.id],
    );
    expect(eventsAfterSecondTick).toHaveLength(1);
  });

  it('a commute whose day-of-week does not match today does nothing', async () => {
    const user = await insertUser(ctx.pool, { email: 'wrong-day@example.com' });
    const endpoint = 'https://push.example.com/wrong-day/1';
    await insertPushSubscription(ctx.pool, { userId: user.id, endpoint });
    const otherDow = (TODAY_DOW + 1) % 7;
    const commute = await insertCommute(ctx.pool, {
      userId: user.id,
      cityId: ctx.seeded.cityId,
      originStationPk: ctx.seeded.near1.id,
      destStationPk: ctx.seeded.hub.id,
      departLocalTime: '08:15',
      rideMinutes: 10,
      daysOfWeek: [otherDow],
      alertLeadMinutes: 20,
      threshold: 0.7,
    });

    const before = calls.length;
    await tick(deps, NOW);
    expect(calls.length).toBe(before);
    const events = await many(ctx.pool, `SELECT 1 FROM alert_events WHERE commute_id = $1`, [
      commute.id,
    ]);
    expect(events).toHaveLength(0);
  });

  it("a 'typical'-kind leg never triggers, even when its probability is numerically below threshold", async () => {
    const user = await insertUser(ctx.pool, { email: 'typical-leg@example.com' });
    const endpoint = 'https://push.example.com/typical-leg/1';
    await insertPushSubscription(ctx.pool, { userId: user.id, endpoint });
    // depart 09:55 local, lead 120 -> now_local 07:55 (same NOW as the main scenario).
    // origin (far1, lead 120 exactly) has p_bike 0.99 at every horizon -> never low.
    // dest (hub, ride_minutes 180 -> lead 300) falls beyond MAX_LEAD -> kind 'typical',
    // p_dock 0.44 (well below the 0.7 threshold) but must not trigger (kind != 'forecast').
    const commute = await insertCommute(ctx.pool, {
      userId: user.id,
      cityId: ctx.seeded.cityId,
      originStationPk: ctx.seeded.far1.id,
      destStationPk: ctx.seeded.hub.id,
      departLocalTime: '09:55',
      rideMinutes: 180,
      daysOfWeek: [TODAY_DOW],
      alertLeadMinutes: 120,
      threshold: 0.7,
    });

    const before = calls.length;
    await tick(deps, NOW);
    expect(calls.length).toBe(before);
    const events = await many(ctx.pool, `SELECT 1 FROM alert_events WHERE commute_id = $1`, [
      commute.id,
    ]);
    expect(events).toHaveLength(0);
  });

  it('transport returning 410 deletes the subscription', async () => {
    const user = await insertUser(ctx.pool, { email: 'gone-410-scheduler@example.com' });
    const endpoint = 'https://push.example.com/gone-410/scheduler';
    await insertPushSubscription(ctx.pool, { userId: user.id, endpoint });
    await insertCommute(ctx.pool, {
      userId: user.id,
      cityId: ctx.seeded.cityId,
      originStationPk: ctx.seeded.near1.id,
      destStationPk: ctx.seeded.hub.id,
      departLocalTime: '08:15',
      rideMinutes: 10,
      daysOfWeek: [TODAY_DOW],
      alertLeadMinutes: 20,
      threshold: 0.7,
    });

    await tick(deps, NOW);

    const remaining = await ctx.pool.query('SELECT 1 FROM push_subscriptions WHERE endpoint = $1', [
      endpoint,
    ]);
    expect(remaining.rowCount).toBe(0);
  });

  it('5 accumulated other-error sends across due commutes delete the subscription', async () => {
    const user = await insertUser(ctx.pool, { email: 'always-fails-scheduler@example.com' });
    const endpoint = 'https://push.example.com/always-fails/scheduler';
    await insertPushSubscription(ctx.pool, { userId: user.id, endpoint });
    // 5 distinct commutes, all due in this same tick, all sending to the same subscription.
    for (let i = 0; i < 5; i++) {
      // eslint-disable-next-line no-await-in-loop
      await insertCommute(ctx.pool, {
        userId: user.id,
        name: `Failing commute ${i}`,
        cityId: ctx.seeded.cityId,
        originStationPk: ctx.seeded.near1.id,
        destStationPk: ctx.seeded.hub.id,
        departLocalTime: '08:15',
        rideMinutes: 10,
        daysOfWeek: [TODAY_DOW],
        alertLeadMinutes: 20,
        threshold: 0.7,
      });
    }

    await tick(deps, NOW);

    const remaining = await ctx.pool.query('SELECT 1 FROM push_subscriptions WHERE endpoint = $1', [
      endpoint,
    ]);
    expect(remaining.rowCount).toBe(0);
  });
});
