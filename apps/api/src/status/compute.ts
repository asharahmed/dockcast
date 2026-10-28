/**
 * Pure computation behind `GET /status` (`docs/api.md` §1): turns `worker_runs` rows into the
 * public training view. Everything read from the stored `summary.progress` JSON is re-validated
 * here and rebuilt from allowlisted names, numbers and dates, so nothing else in a run's summary
 * (or its `error` text) can reach the response.
 */
import {
  TRAIN_PHASES,
  type StatusTrainCurrent,
  type StatusTrainRun,
  type TrainPhase,
} from '@dockcast/shared';

/** No progress write (marker or 30 s heartbeat) for this long means the trainer process is gone. */
export const STALL_AFTER_S = 600;
/** The percent bar never claims completion; only a finished run does. */
export const PERCENT_CAP = 97;
/** An unfinished run older than this is history, not "current". */
export const CURRENT_MAX_AGE_S = 12 * 3600;

export interface ParsedPhase {
  phase: TrainPhase;
  ts: Date;
  peakRssMib: number | null;
}

export interface ParsedProgress {
  phases: ParsedPhase[];
  attempt: number | null;
  maxAttempts: number | null;
  updatedAt: Date | null;
}

export interface TrainRunRow {
  started_at: Date;
  finished_at: Date | null;
  ok: boolean | null;
  progress: unknown;
  gate_passed: boolean | null;
  val_brier_bike: number | null;
  val_brier_dock: number | null;
  gbm_status: StatusTrainRun['gbm_status'];
}

const PHASE_SET: ReadonlySet<string> = new Set(TRAIN_PHASES);

function asDate(v: unknown): Date | null {
  if (typeof v !== 'string') return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function asNum(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v < 1e7 ? v : null;
}

function asSmallInt(v: unknown): number | null {
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 99 ? v : null;
}

/** Defensive parse of `summary.progress`; unknown phases and malformed entries are dropped. */
export function parseProgress(raw: unknown): ParsedProgress {
  const out: ParsedProgress = { phases: [], attempt: null, maxAttempts: null, updatedAt: null };
  if (typeof raw !== 'object' || raw === null) return out;
  const r = raw as Record<string, unknown>;
  out.attempt = asSmallInt(r.attempt);
  out.maxAttempts = asSmallInt(r.max_attempts);
  out.updatedAt = asDate(r.updated_at);
  if (Array.isArray(r.phases)) {
    const byPhase = new Map<TrainPhase, ParsedPhase>();
    for (const p of r.phases) {
      if (typeof p !== 'object' || p === null) continue;
      const e = p as Record<string, unknown>;
      const ts = asDate(e.ts);
      if (typeof e.phase !== 'string' || !PHASE_SET.has(e.phase) || !ts) continue;
      byPhase.set(e.phase as TrainPhase, {
        phase: e.phase as TrainPhase,
        ts,
        peakRssMib: asNum(e.peak_rss_mib),
      });
    }
    out.phases = [...byPhase.values()].sort((a, b) => a.ts.getTime() - b.ts.getTime());
  }
  return out;
}

const secs = (a: Date, b: Date): number => Math.max(0, Math.round((a.getTime() - b.getTime()) / 1000));

function peakOf(p: ParsedProgress): number | null {
  const peaks = p.phases.map((x) => x.peakRssMib).filter((x): x is number => x !== null);
  return peaks.length ? Math.max(...peaks) : null;
}

/** Offsets (seconds from run start) at which a successful run finished each phase, plus its total. */
export interface Reference {
  offsets: Map<TrainPhase, number>;
  total_s: number;
}

export function buildReference(run: {
  started_at: Date;
  finished_at: Date | null;
  progress: unknown;
}): Reference | null {
  if (!run.finished_at) return null;
  const total = secs(run.finished_at, run.started_at);
  if (total <= 0) return null;
  const offsets = new Map<TrainPhase, number>();
  for (const p of parseProgress(run.progress).phases) {
    const o = secs(p.ts, run.started_at);
    if (o <= total) offsets.set(p.phase, o);
  }
  return offsets.size ? { offsets, total_s: total } : null;
}

export function buildCurrent(
  run: { started_at: Date; progress: unknown },
  reference: Reference | null,
  now: Date,
): StatusTrainCurrent {
  const prog = parseProgress(run.progress);
  const last = prog.phases[prog.phases.length - 1];
  const lastWrite = prog.updatedAt ?? last?.ts ?? run.started_at;
  const stalled = secs(now, lastWrite) > STALL_AFTER_S;
  // A stalled run's clock stops at its last sign of life so the bar does not creep forward.
  const clock = stalled ? lastWrite : now;

  const lastIdx = last ? TRAIN_PHASES.indexOf(last.phase) : -1;
  const phase = TRAIN_PHASES[lastIdx + 1] ?? null;

  let percent: number | null = null;
  let eta: number | null = null;
  if (reference) {
    // Anchor on the latest finished phase that the reference run also has.
    let anchorOffset = 0;
    let anchorTs = run.started_at;
    for (let i = prog.phases.length - 1; i >= 0; i--) {
      const p = prog.phases[i]!;
      const o = reference.offsets.get(p.phase);
      if (o !== undefined) {
        anchorOffset = o;
        anchorTs = p.ts;
        break;
      }
    }
    // The next reference phase boundary bounds how far the interpolation may run.
    let bound = reference.total_s;
    for (const [p, o] of reference.offsets) {
      if (o > anchorOffset && o < bound && TRAIN_PHASES.indexOf(p) > lastIdx) bound = o;
    }
    const inPhase = Math.min(secs(clock, anchorTs), Math.max(0, bound - anchorOffset));
    const pos = anchorOffset + inPhase;
    percent = Math.round(Math.min(PERCENT_CAP, (100 * pos) / reference.total_s) * 10) / 10;
    eta = Math.max(0, Math.round(reference.total_s - pos));
  }

  return {
    started_at: run.started_at.toISOString(),
    phase,
    phases: prog.phases.map((p) => ({
      phase: p.phase,
      ts: p.ts.toISOString(),
      peak_rss_mib: p.peakRssMib,
    })),
    attempt: prog.attempt,
    max_attempts: prog.maxAttempts,
    elapsed_s: secs(clock, run.started_at),
    percent,
    eta_s: eta,
    state: stalled ? 'stalled' : 'running',
  };
}

export function buildHistoryRow(row: TrainRunRow): StatusTrainRun {
  const prog = parseProgress(row.progress);
  return {
    started_at: row.started_at.toISOString(),
    duration_s: row.finished_at ? secs(row.finished_at, row.started_at) : null,
    ok: row.finished_at ? row.ok : null,
    attempt: prog.attempt,
    peak_rss_mib: peakOf(prog),
    gate_passed: row.gate_passed,
    val_brier_bike: row.val_brier_bike,
    val_brier_dock: row.val_brier_dock,
    gbm_status: row.gbm_status,
  };
}
