import { describe, expect, it } from 'vitest';
import { buildReference, buildRunning, parseProgress, STALL_AFTER_S } from '../src/status/compute.js';
import { STAGE_OF_PHASE, TRAIN_PHASES } from '../src/status/stage.js';
import {
  coarseAgo,
  dayCell,
  forecastsState,
  lastDays,
  modelsState,
  stationsState,
  uptimePct,
} from '../src/status/health.js';
import { LatencyTracker } from '../src/status/latency.js';
import { createSnapshotCache } from '../src/status/cache.js';
import { modelUpdateRows } from '../src/status/snapshot.js';
import { STATUS_STAGES } from '@dockcast/shared';

const T0 = new Date('2026-03-10T00:00:00Z');
const at = (s: number): Date => new Date(T0.getTime() + s * 1000);

describe('stage map', () => {
  it('maps every internal phase onto one of the four public labels, in non-decreasing order', () => {
    const order = TRAIN_PHASES.map((p) => STATUS_STAGES.indexOf(STAGE_OF_PHASE[p]));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(new Set(order).size).toBe(4);
  });
});

describe('buildRunning', () => {
  const ref = buildReference({
    started_at: T0,
    finished_at: at(1800),
    progress: {
      phases: [
        { phase: 'labels', ts: at(300).toISOString() },
        { phase: 'serving_profile', ts: at(600).toISOString() },
        { phase: 'feature_build', ts: at(1200).toISOString() },
      ],
    },
  });

  it('rounds percent to a whole number and ETA to whole minutes', () => {
    const run = { started_at: T0, progress: { phases: [{ phase: 'labels', ts: at(300).toISOString() }], updated_at: at(490).toISOString() } };
    const r = buildRunning(run, ref, at(500));
    expect(r.percent).toBe(Math.round((500 / 1800) * 100));
    expect(r.eta_min).toBe(Math.round((1800 - 500) / 60));
    expect(r.stalled).toBe(false);
    expect(r.stage).toBe('preparing data');
  });

  it('caps percent at 97 and has no percent or ETA without a reference run', () => {
    const run = { started_at: T0, progress: { phases: [], updated_at: at(1790).toISOString() } };
    expect(buildRunning(run, ref, at(1795)).percent).toBeLessThanOrEqual(97);
    const none = buildRunning(run, null, at(100));
    expect(none.percent).toBeNull();
    expect(none.eta_min).toBeNull();
  });

  it('is stalled after 10 quiet minutes and freezes its clock', () => {
    const run = { started_at: T0, progress: { phases: [], updated_at: at(60).toISOString() } };
    expect(buildRunning(run, ref, at(60 + STALL_AFTER_S + 1)).stalled).toBe(true);
    expect(buildRunning(run, ref, at(60 + STALL_AFTER_S - 1)).stalled).toBe(false);
  });

  it('reports "publishing" once every phase has finished', () => {
    const phases = TRAIN_PHASES.map((phase, i) => ({ phase, ts: at(i * 10).toISOString() }));
    expect(buildRunning({ started_at: T0, progress: { phases, updated_at: at(200).toISOString() } }, null, at(205)).stage).toBe('publishing');
  });
});

describe('parseProgress', () => {
  it('drops unknown phase names and ignores memory and attempt fields', () => {
    const p = parseProgress({
      attempt: 3,
      phases: [
        { phase: 'labels', ts: at(1).toISOString(), peak_rss_mib: 9999 },
        { phase: 'SECRET host', ts: at(2).toISOString() },
        { phase: 'labels', ts: 'not a date' },
      ],
    });
    expect(p.phases).toEqual([{ phase: 'labels', ts: at(1) }]);
    expect(JSON.stringify(p)).not.toMatch(/9999|attempt/);
  });
});

describe('component thresholds', () => {
  it('stations: 5 and 15 minute thresholds', () => {
    expect(stationsState(60)).toBe('operational');
    expect(stationsState(5 * 60)).toBe('operational');
    expect(stationsState(5 * 60 + 1)).toBe('degraded');
    expect(stationsState(15 * 60 + 1)).toBe('down');
    expect(stationsState(null)).toBe('down');
  });
  it('forecasts: 30 and 90 minute thresholds, failed last run degrades', () => {
    expect(forecastsState(29 * 60, true)).toBe('operational');
    expect(forecastsState(29 * 60, false)).toBe('degraded');
    expect(forecastsState(31 * 60, true)).toBe('degraded');
    expect(forecastsState(91 * 60, true)).toBe('down');
  });
  it('models: 36 h and 96 h thresholds', () => {
    const base = { running: false, stalled: false, lastFinishedFailedAfterSuccess: false };
    expect(modelsState({ ...base, lastSuccessAgeS: 24 * 3600 })).toBe('operational');
    expect(modelsState({ ...base, lastSuccessAgeS: 40 * 3600 })).toBe('degraded');
    expect(modelsState({ ...base, lastSuccessAgeS: 100 * 3600 })).toBe('down');
    expect(modelsState({ ...base, lastSuccessAgeS: null })).toBe('degraded');
    expect(modelsState({ ...base, lastSuccessAgeS: 3600, lastFinishedFailedAfterSuccess: true })).toBe('degraded');
    expect(modelsState({ ...base, lastSuccessAgeS: 3600, stalled: true, running: true })).toBe('degraded');
  });
});

describe('uptime math', () => {
  const now = new Date('2026-03-10T12:00:00Z');
  const day = 86_400_000;
  it('is ok samples over expected minutes, floored to one decimal', () => {
    const first = new Date(now.getTime() - 30 * day);
    expect(uptimePct(7 * 1440, first, now, 7 * day)).toBe(100);
    expect(uptimePct(7 * 1440 - 10, first, now, 7 * day)).toBe(99.9); // 99.9008 -> 99.9
    expect(uptimePct(7 * 1440 - 11, first, now, 7 * day)).toBe(99.8);
    expect(uptimePct(7 * 1440 - 50, first, now, 7 * day)).toBe(99.5); // 99.504 floors to 99.5
  });
  it('starts the window at the first sample, and never exceeds 100', () => {
    const first = new Date(now.getTime() - 2 * 3600_000);
    expect(uptimePct(120, first, now, 30 * day)).toBe(100);
    expect(uptimePct(130, first, now, 30 * day)).toBe(100);
    expect(uptimePct(60, first, now, 30 * day)).toBe(50);
  });
  it('is null with no history or under ten minutes of it', () => {
    expect(uptimePct(0, null, now, day)).toBeNull();
    expect(uptimePct(5, new Date(now.getTime() - 5 * 60_000), now, day)).toBeNull();
  });
  it('day cells: ok at >= 99%, down below, none before the first sample', () => {
    const first = new Date('2026-03-01T00:00:00Z');
    expect(dayCell('2026-03-05', 1440, first, now)).toBe('ok');
    expect(dayCell('2026-03-05', 1426, first, now)).toBe('ok'); // 99.03%
    expect(dayCell('2026-03-05', 1420, first, now)).toBe('down');
    expect(dayCell('2026-03-05', 0, first, now)).toBe('down');
    expect(dayCell('2026-02-27', 0, first, now)).toBe('none');
    expect(dayCell('2026-03-05', 0, null, now)).toBe('none');
    // today is partial: 12 h elapsed
    expect(dayCell('2026-03-10', 720, first, now)).toBe('ok');
    // the first day only counts minutes since the first sample
    expect(dayCell('2026-03-01', 1440, new Date('2026-03-01T12:00:00Z'), now)).toBe('ok');
  });
  it('lists 14 UTC dates ending today', () => {
    const d = lastDays(now);
    expect(d).toHaveLength(14);
    expect(d[13]).toBe('2026-03-10');
    expect(d[0]).toBe('2026-02-25');
  });
});

describe('coarseAgo', () => {
  it('uses minutes, then hours, then days', () => {
    expect(coarseAgo(5 * 60_000)).toEqual({ value: 5, unit: 'minutes' });
    expect(coarseAgo(3 * 3600_000 + 20 * 60_000)).toEqual({ value: 3, unit: 'hours' });
    expect(coarseAgo(3 * 86_400_000 + 5 * 3600_000)).toEqual({ value: 3, unit: 'days' });
  });
});

describe('modelUpdateRows', () => {
  it('collapses same-day retries, hides unfinished rows, newest first', () => {
    const r = (start: string, mins: number | null, ok: boolean | null) => ({
      started_at: new Date(start),
      finished_at: mins === null ? null : new Date(new Date(start).getTime() + mins * 60_000),
      ok,
    });
    const rows = modelUpdateRows([
      r('2026-03-09T09:00:00Z', 41.4, true), // retry that worked
      r('2026-03-09T07:30:00Z', 3, false),
      r('2026-03-08T07:30:00Z', null, null), // crashed attempt
      r('2026-03-07T07:30:00Z', 30, false),
    ]);
    expect(rows).toEqual([
      { date: '2026-03-09', ok: true, duration_min: 41 },
      { date: '2026-03-07', ok: false, duration_min: 30 },
    ]);
  });
});

describe('LatencyTracker', () => {
  it('buckets the 75th percentile of the last 5 minutes', () => {
    const t = new LatencyTracker();
    expect(t.bucket(1000)).toBeNull();
    for (const ms of [50, 60, 70, 80]) t.record(ms, 1000);
    expect(t.bucket(1000)).toBe('fast');
    for (const ms of [2000, 2000, 2000, 2000, 2000]) t.record(ms, 1000);
    expect(t.bucket(1000)).toBe('slow');
    expect(t.bucket(1000 + 6 * 60_000)).toBeNull();
  });
});

describe('createSnapshotCache', () => {
  it('computes once per window under concurrent calls and again after expiry', async () => {
    let clock = 0;
    let calls = 0;
    const cache = createSnapshotCache(async () => ++calls, 15_000, () => clock);
    const first = await Promise.all(Array.from({ length: 50 }, () => cache.get()));
    expect(new Set(first)).toEqual(new Set([1]));
    clock = 14_999;
    expect(await cache.get()).toBe(1);
    clock = 15_000;
    expect(await cache.get()).toBe(2);
    expect(calls).toBe(2);
  });
});
