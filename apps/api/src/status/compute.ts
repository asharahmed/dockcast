/**
 * Pure computation behind `GET /status`: turns a sanitized `worker_runs` progress record into the
 * public "model update in progress" view. The SQL already reduces the stored progress to phase
 * names and timestamps (`services/status.queries.ts`); everything is re-validated here against the
 * phase allowlist, and only a coarse stage, a whole percent and whole minutes leave this module.
 */
import type { StatusStage } from '@dockcast/shared';
import { FINAL_STAGE, STAGE_OF_PHASE, TRAIN_PHASES, type TrainPhase } from './stage.js';

/** No progress write (marker or 30 s heartbeat) for this long means the trainer process is gone. */
export const STALL_AFTER_S = 600;
/** The percent never claims completion; only a finished run does. */
export const PERCENT_CAP = 97;
/** An unfinished run older than this is history, not "running". */
export const RUNNING_MAX_AGE_S = 12 * 3600;

export interface ParsedPhase {
  phase: TrainPhase;
  ts: Date;
}
export interface ParsedProgress {
  phases: ParsedPhase[];
  updatedAt: Date | null;
}

const PHASE_SET: ReadonlySet<string> = new Set(TRAIN_PHASES);

function asDate(v: unknown): Date | null {
  if (typeof v !== 'string') return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Defensive parse; unknown phase names and malformed entries are dropped. */
export function parseProgress(raw: unknown): ParsedProgress {
  const out: ParsedProgress = { phases: [], updatedAt: null };
  if (typeof raw !== 'object' || raw === null) return out;
  const r = raw as Record<string, unknown>;
  out.updatedAt = asDate(r.updated_at);
  if (Array.isArray(r.phases)) {
    const byPhase = new Map<TrainPhase, ParsedPhase>();
    for (const p of r.phases) {
      if (typeof p !== 'object' || p === null) continue;
      const e = p as Record<string, unknown>;
      const ts = asDate(e.ts);
      if (typeof e.phase !== 'string' || !PHASE_SET.has(e.phase) || !ts) continue;
      byPhase.set(e.phase as TrainPhase, { phase: e.phase as TrainPhase, ts });
    }
    out.phases = [...byPhase.values()].sort((a, b) => a.ts.getTime() - b.ts.getTime());
  }
  return out;
}

const secs = (a: Date, b: Date): number => Math.max(0, Math.round((a.getTime() - b.getTime()) / 1000));

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

export interface Running {
  stalled: boolean;
  percent: number | null;
  stage: StatusStage;
  eta_min: number | null;
}

export function buildRunning(
  run: { started_at: Date; progress: unknown },
  reference: Reference | null,
  now: Date,
): Running {
  const prog = parseProgress(run.progress);
  const last = prog.phases[prog.phases.length - 1];
  const lastWrite = prog.updatedAt ?? last?.ts ?? run.started_at;
  const stalled = secs(now, lastWrite) > STALL_AFTER_S;
  // A stalled run's clock stops at its last sign of life so the bar does not creep forward.
  const clock = stalled ? lastWrite : now;

  const lastIdx = last ? TRAIN_PHASES.indexOf(last.phase) : -1;
  const next = TRAIN_PHASES[lastIdx + 1];
  const stage = next ? STAGE_OF_PHASE[next] : FINAL_STAGE;

  let percent: number | null = null;
  let etaMin: number | null = null;
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
    percent = Math.round(Math.min(PERCENT_CAP, (100 * pos) / reference.total_s));
    etaMin = Math.max(0, Math.round((reference.total_s - pos) / 60));
  }
  return { stalled, percent, stage, eta_min: etaMin };
}
