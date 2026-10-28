/**
 * Pure text helpers for the terminal-style `/status` page (`docs/ui-spec.md` §4.10).
 */
import {
  TRAIN_SCHEDULE_LOCAL,
  TRAIN_SCHEDULE_TZ,
  nextOccurrence,
  type StatusTrainRun,
  type TrainPhase,
} from '@dockcast/shared';

const PARTIAL = ['', '▏', '▎', '▍', '▌', '▋', '▊', '▉'];
export const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const SPARK = '▁▂▃▄▅▆▇█';

/** Human words for the work in progress, keyed by the marker that will end it. */
export const PHASE_WORDS: Record<TrainPhase, string> = {
  labels: 'materialising labels',
  serving_profile: "building today's serving profile",
  bd_calibration: 'calibrating the birth-death model',
  train_profile: 'building the training profile',
  row_counts: 'counting training rows',
  feature_build: 'building features',
  feature_matrices: 'assembling feature matrices',
  calibration: 'fitting the boosted model and calibrators',
  val_scoring: 'scoring validation days',
  release: 'releasing memory',
  metrics_online: 'computing online metrics',
};

export function phaseWords(phase: TrainPhase | null): string {
  return phase ? PHASE_WORDS[phase] : 'finishing up';
}

/** `width` cells of █ with an eighth-block tail, then ░ padding. */
export function progressBar(percent: number, width: number): string {
  const clamped = Math.min(100, Math.max(0, percent));
  const eighths = Math.round((clamped / 100) * width * 8);
  const full = Math.floor(eighths / 8);
  const part = eighths % 8;
  const bar = '█'.repeat(full) + PARTIAL[part];
  return bar + '░'.repeat(Math.max(0, width - bar.length));
}

/** 754 -> `12m34s`, 3700 -> `1h01m`, 42 -> `42s`. */
export function fmtDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m${String(s % 60).padStart(2, '0')}s`;
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m`;
}

/** `42s ago`, `5m ago`, `3h ago`, `2d ago`; `never` for null. */
export function fmtAge(seconds: number | null): string {
  if (seconds === null) return 'never';
  if (seconds < 90) return `${seconds}s ago`;
  if (seconds < 5400) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 172800) return `${Math.round(seconds / 3600)}h ago`;
  return `${Math.round(seconds / 86400)}d ago`;
}

export function fmtMem(mib: number | null): string {
  if (mib === null) return '--';
  return mib >= 1024 ? `${(mib / 1024).toFixed(1)} GiB` : `${Math.round(mib)} MiB`;
}

/** Sparkline over `values`, scaled min..max; `null` entries become a blank. */
export function sparkline(values: (number | null)[]): string {
  const nums = values.filter((v): v is number => v !== null);
  if (nums.length === 0) return '';
  const lo = Math.min(...nums);
  const hi = Math.max(...nums);
  return values
    .map((v) => {
      if (v === null) return ' ';
      const idx = hi === lo ? 3 : Math.round(((v - lo) / (hi - lo)) * (SPARK.length - 1));
      return SPARK[idx];
    })
    .join('');
}

function tzAbbrev(now: Date): string {
  const part = new Intl.DateTimeFormat('en-US', { timeZone: TRAIN_SCHEDULE_TZ, timeZoneName: 'short' })
    .formatToParts(now)
    .find((p) => p.type === 'timeZoneName');
  return part?.value ?? '';
}

/** `03:30 EDT` and seconds until the next scheduled trainer start. */
export function nextRun(now: Date): { label: string; in_s: number } {
  const next = nextOccurrence(now, TRAIN_SCHEDULE_TZ, TRAIN_SCHEDULE_LOCAL, [0, 1, 2, 3, 4, 5, 6]);
  return {
    label: `${TRAIN_SCHEDULE_LOCAL} ${tzAbbrev(next ?? now)}`.trim(),
    in_s: next ? Math.max(0, Math.round((next.getTime() - now.getTime()) / 1000)) : 0,
  };
}

/** `Oct 27 03:30` in the trainer's time zone. */
export function fmtRunStart(iso: string): string {
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TRAIN_SCHEDULE_TZ,
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(d);
  const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('month')} ${get('day')} ${get('hour')}:${get('minute')}`;
}

function gateCell(run: StatusTrainRun): string {
  if (run.gate_passed === null) return run.gbm_status === 'insufficient_data' ? 'n/a' : '--';
  return run.gate_passed ? 'pass' : 'fail';
}

/** The recent-runs ASCII table, one string per line (header, rule, rows). */
export function runsTable(history: StatusTrainRun[]): string[] {
  const rows = history.map((r) => [
    fmtRunStart(r.started_at),
    r.duration_s === null ? '--' : fmtDuration(r.duration_s),
    r.ok === null ? '…' : r.ok ? '✔' : '✘',
    fmtMem(r.peak_rss_mib),
    gateCell(r),
    r.val_brier_bike === null ? '--' : r.val_brier_bike.toFixed(3),
    r.val_brier_dock === null ? '--' : r.val_brier_dock.toFixed(3),
    r.attempt === null ? '--' : String(r.attempt),
  ]);
  const head = ['started', 'took', 'ok', 'peak', 'gate', 'brier.bike', 'brier.dock', 'try'];
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i]!.length)));
  const line = (cells: string[]): string =>
    '| ' + cells.map((c, i) => c.padEnd(widths[i]!)).join(' | ') + ' |';
  const rule = '+' + widths.map((w) => '-'.repeat(w + 2)).join('+') + '+';
  return [rule, line(head), rule, ...rows.map(line), rule];
}
