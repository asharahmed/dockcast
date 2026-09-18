/**
 * City-tz display helpers. ui-spec.md §1 `lib/time.ts`, §5 (`fmtPct`/relative
 * time table). Calendar/day-of-week logic (`nextOccurrence`) stays in
 * `@dockcast/shared` (plan.md §1 R5) — this module only formats for display.
 */
import { TZDate } from '@date-fns/tz';
import { format, formatDistanceStrict, parseISO } from 'date-fns';
import { localParts, zonedTimeToUtc } from '@dockcast/shared';

const HHMM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Format an instant as wall-clock time in `tzName`. Default `h:mm a` (ui-spec.md §5). */
export function fmtLocalTime(date: Date, tzName: string, formatStr = 'h:mm a'): string {
  return format(TZDate.tz(tzName, date), formatStr);
}

/**
 * Format a plain `YYYY-MM-DD` day (a `model_metrics_daily.day`) as `d MMM`.
 * `parseISO` reads a date-only string as local midnight, so the day never
 * slides backwards the way `new Date('2026-09-12')` (UTC midnight) would.
 */
export function fmtDayShort(day: string): string {
  return format(parseISO(day), 'd MMM');
}

/** Parse a validated `HH:MM` string (throws on malformed input). */
export function parseHHMM(hhmm: string): { hour: number; minute: number } {
  const match = HHMM_RE.exec(hhmm);
  if (!match) throw new Error(`Invalid HH:MM time: ${hhmm}`);
  const [, hh, mm] = match;
  if (hh === undefined || mm === undefined) throw new Error(`Invalid HH:MM time: ${hhmm}`);
  return { hour: Number(hh), minute: Number(mm) };
}

/**
 * Relative-time text, e.g. "2 min ago". ui-spec.md §5 specifies
 * `formatDistanceToNowStrict`, but that reads `Date.now()` implicitly; per
 * plan.md §1 R9 (no `Date.now()`-dependent logic without an injectable
 * clock) this takes `now` explicitly instead — callers get "now" from the
 * shared `useNow` hook so it's deterministic in tests and stays live in the UI.
 */
export function fmtRelative(date: Date, now: Date): string {
  return `${formatDistanceStrict(date, now)} ago`;
}

/** The `HorizonSlider` stops, minutes from now. ui-spec.md §4.1. */
export const HORIZON_STOPS = [0, 15, 30, 45, 60, 90, 120] as const;

/**
 * Compact tick label for a horizon stop in minutes: "Now", "15m" … "1h30",
 * "2h". ui-spec.md §4.1.
 */
export function horizonTickLabel(minutes: number): string {
  if (minutes === 0) return 'Now';
  if (minutes < 60) return `${minutes}m`;
  if (minutes % 60 === 0) return `${minutes / 60}h`;
  return `${Math.floor(minutes / 60)}h${minutes % 60}`;
}

/**
 * Spaced duration label for the slider's large readout, e.g. "45 min",
 * "1 h 30", "2 h". Used with `COPY.horizon.in` ("In {label}"). ui-spec.md §4.1.
 */
export function horizonDurationLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  if (minutes % 60 === 0) return `${minutes / 60} h`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60}`;
}

/**
 * Convert `hhmm` (wall-clock, `tzName`) on **today's** local calendar date
 * (as observed from `now`) into the UTC instant it denotes — always
 * returned, whether that instant is already in the past or not. ui-spec.md
 * §4.1 `TripPlanner`'s "Leave: At…" field reads this to build the
 * `depart_at` query param; the caller compares the result with `now` to
 * decide whether to show the "That's earlier than now" helper and fall back
 * to `now`. A thin wrapper composing `@dockcast/shared`'s `localParts` +
 * `zonedTimeToUtc` (plan.md §1 R5: never re-declared) rather than
 * `nextOccurrence` — that function searches *forward* to the next matching
 * weekday, which would silently roll a past time to next week instead of
 * reporting "in the past" for today.
 */
export function nextDepart(now: Date, tzName: string, hhmm: string): Date {
  const { year, month, day } = localParts(now, tzName);
  return zonedTimeToUtc({ year, month, day }, hhmm, tzName);
}

/** Minutes between two instants, `b - a` (fractional). */
export function minutesBetween(a: Date, b: Date): number {
  return (b.getTime() - a.getTime()) / 60_000;
}
