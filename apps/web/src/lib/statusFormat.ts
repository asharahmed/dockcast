/**
 * Pure text helpers for the terminal-style `/status` page (`docs/ui-spec.md` §4.10). Everything here
 * formats coarse values the API already rounded; nothing derives anything the API did not send.
 */
import type { StatusDayCell, StatusModelUpdate, StatusState } from '@dockcast/shared';

const PARTIAL = ['', '▏', '▎', '▍', '▌', '▋', '▊', '▉'];
export const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

/** `width` cells of █ with an eighth-block tail, then ░ padding. */
export function progressBar(percent: number, width: number): string {
  const clamped = Math.min(100, Math.max(0, percent));
  const eighths = Math.round((clamped / 100) * width * 8);
  const full = Math.floor(eighths / 8);
  const part = eighths % 8;
  const bar = '█'.repeat(full) + PARTIAL[part];
  return bar + '░'.repeat(Math.max(0, width - bar.length));
}

export function overallLabel(s: StatusState): string {
  return s === 'operational' ? 'all systems operational' : s === 'degraded' ? 'degraded performance' : 'service disruption';
}

/** `just now`, `5 min ago`, `3 h ago`, `2 d ago`; `never` for null. */
export function fmtMinAgo(min: number | null): string {
  if (min === null) return 'never';
  if (min < 1) return 'just now';
  if (min < 120) return `${min} min ago`;
  if (min < 48 * 60) return `${Math.round(min / 60)} h ago`;
  return `${Math.round(min / 1440)} d ago`;
}

/** `4 minutes ago`, `1 hour ago`, `3 days ago` from the API's coarse age. */
export function fmtDeployed(a: { value: number; unit: 'minutes' | 'hours' | 'days' }): string {
  if (a.unit === 'minutes' && a.value < 1) return 'just now';
  const unit = a.value === 1 ? a.unit.slice(0, -1) : a.unit;
  return `${a.value} ${unit} ago`;
}

/** `2026-10-27` -> `Oct 27` (the date is a UTC date; no time zone conversion). */
export function fmtDate(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return '--';
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' }).format(d);
}

/** 41 -> `41 min`, 65 -> `1 h 05 min`. */
export function fmtMinutes(min: number | null): string {
  if (min === null) return '--';
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')} min`;
}

export function fmtPct(p: number | null): string {
  return p === null ? '--' : `${p.toFixed(1)}%`;
}

const CELL_GLYPH: Record<StatusDayCell, string> = { ok: '✔', down: '✘', none: '·' };

export function stripGlyphs(cells: StatusDayCell[]): string[] {
  return cells.map((c) => CELL_GLYPH[c]);
}

/** Screen-reader text for a strip, since the glyphs themselves are hidden from it. */
export function stripSummary(cells: StatusDayCell[]): string {
  const up = cells.filter((c) => c === 'ok').length;
  const down = cells.filter((c) => c === 'down').length;
  return `${up} days up, ${down} days with downtime, ${cells.length - up - down} days without data`;
}

/** The recent model updates as an ASCII table, one string per line (rule, header, rule, rows, rule). */
export function updatesTable(rows: StatusModelUpdate[]): string[] {
  const body = rows.map((r) => [fmtDate(r.date), r.ok ? '✔' : '✘', fmtMinutes(r.duration_min)]);
  const head = ['date', 'ok', 'took'];
  const widths = head.map((h, i) => Math.max(h.length, ...body.map((r) => r[i]!.length)));
  const line = (cells: string[]): string =>
    '| ' + cells.map((c, i) => c.padEnd(widths[i]!)).join(' | ') + ' |';
  const rule = '+' + widths.map((w) => '-'.repeat(w + 2)).join('+') + '+';
  return [rule, line(head), rule, ...body.map(line), rule];
}
