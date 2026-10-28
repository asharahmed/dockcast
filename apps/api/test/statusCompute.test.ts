import { describe, expect, it } from 'vitest';
import {
  buildCurrent,
  buildHistoryRow,
  buildReference,
  parseProgress,
  STALL_AFTER_S,
} from '../src/status/compute.js';

const T0 = new Date('2026-03-10T07:30:00.000Z');
const at = (s: number): Date => new Date(T0.getTime() + s * 1000);
const iso = (s: number): string => at(s).toISOString();

/** A finished 1000 s run: labels@100, serving_profile@200, bd_calibration@400, metrics_online@900. */
const refRun = {
  started_at: T0,
  finished_at: at(1000),
  progress: {
    phases: [
      { phase: 'labels', ts: iso(100), peak_rss_mib: 500 },
      { phase: 'serving_profile', ts: iso(200), peak_rss_mib: 700 },
      { phase: 'bd_calibration', ts: iso(400), peak_rss_mib: 2100 },
      { phase: 'metrics_online', ts: iso(900), peak_rss_mib: 1200 },
    ],
  },
};

describe('parseProgress', () => {
  it('keeps allowlisted phases only and ignores junk', () => {
    const p = parseProgress({
      attempt: 2,
      max_attempts: 6,
      updated_at: iso(5),
      host: 'asharpc',
      phases: [
        { phase: 'labels', ts: iso(10), peak_rss_mib: 100, path: '/data/x' },
        { phase: '/etc/passwd', ts: iso(11), peak_rss_mib: 1 },
        { phase: 'feature_build', ts: 'not a date', peak_rss_mib: 1 },
        { phase: 'release', ts: iso(12), peak_rss_mib: 'big' },
        null,
      ],
    });
    expect(p.phases.map((x) => x.phase)).toEqual(['labels', 'release']);
    expect(p.phases[1]!.peakRssMib).toBeNull();
    expect(p.attempt).toBe(2);
    expect(JSON.stringify(p)).not.toContain('asharpc');
  });

  it('tolerates non-objects', () => {
    expect(parseProgress(null).phases).toEqual([]);
    expect(parseProgress('x').attempt).toBeNull();
  });
});

describe('buildCurrent', () => {
  const ref = buildReference(refRun)!;

  it('has null percent without a reference run', () => {
    const c = buildCurrent({ started_at: T0, progress: { updated_at: iso(50), phases: [] } }, null, at(60));
    expect(c.percent).toBeNull();
    expect(c.eta_s).toBeNull();
    expect(c.phase).toBe('labels');
    expect(c.state).toBe('running');
    expect(c.elapsed_s).toBe(60);
  });

  it('interpolates inside the current phase against the reference offsets', () => {
    // labels finished at +100; reference serving_profile boundary is +200, so +50 s in => pos 150.
    const c = buildCurrent(
      {
        started_at: T0,
        progress: {
          attempt: 1,
          max_attempts: 6,
          updated_at: iso(150),
          phases: [{ phase: 'labels', ts: iso(100), peak_rss_mib: 480 }],
        },
      },
      ref,
      at(150),
    );
    expect(c.phase).toBe('serving_profile');
    expect(c.percent).toBe(15);
    expect(c.eta_s).toBe(850);
    expect(c.attempt).toBe(1);
  });

  it('stops interpolating at the next phase boundary and caps at 97%', () => {
    const slow = buildCurrent(
      {
        started_at: T0,
        progress: { updated_at: iso(5000), phases: [{ phase: 'labels', ts: iso(100), peak_rss_mib: 1 }] },
      },
      ref,
      at(5000),
    );
    expect(slow.percent).toBe(20); // pinned at the serving_profile boundary (200/1000)

    const tail = buildCurrent(
      {
        started_at: T0,
        progress: { updated_at: iso(990), phases: [{ phase: 'metrics_online', ts: iso(900), peak_rss_mib: 1 }] },
      },
      ref,
      at(990),
    );
    expect(tail.phase).toBeNull();
    expect(tail.percent).toBe(97);
  });

  it('reports stalled after the progress heartbeat goes quiet, freezing the clock', () => {
    const c = buildCurrent(
      { started_at: T0, progress: { updated_at: iso(300), phases: [] } },
      ref,
      at(300 + STALL_AFTER_S + 1),
    );
    expect(c.state).toBe('stalled');
    expect(c.elapsed_s).toBe(300);
  });
});

describe('buildReference', () => {
  it('rejects unfinished or phase-less runs', () => {
    expect(buildReference({ ...refRun, finished_at: null })).toBeNull();
    expect(buildReference({ ...refRun, progress: null })).toBeNull();
  });
});

describe('buildHistoryRow', () => {
  it('derives duration, peak and null ok for an unfinished run', () => {
    const base = {
      started_at: T0,
      progress: refRun.progress,
      gate_passed: null,
      val_brier_bike: null,
      val_brier_dock: null,
      gbm_status: null,
    };
    const done = buildHistoryRow({ ...base, finished_at: at(1000), ok: true });
    expect(done.duration_s).toBe(1000);
    expect(done.peak_rss_mib).toBe(2100);
    expect(done.ok).toBe(true);
    const dead = buildHistoryRow({ ...base, finished_at: null, ok: null });
    expect(dead.ok).toBeNull();
    expect(dead.duration_s).toBeNull();
  });
});
