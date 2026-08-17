/**
 * City-local time helpers, built on `@date-fns/tz` (`TZDate`, `tz`) and
 * `date-fns` v4 — no moment/luxon. `docs/ml-spec.md` §0 (day-type/bucket
 * definitions), `docs/api.md` §0.1 / §8 (commute scheduling).
 *
 * All calendar/day-boundary logic here is DST-safe: it never adds a fixed
 * number of milliseconds across a day boundary. Wall-clock arithmetic goes
 * through `TZDate`/`date-fns` so it respects the target IANA zone's actual
 * offset changes.
 */
import { TZDate, tz } from '@date-fns/tz';
import { addDays } from 'date-fns';

const HHMM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

function parseHhmm(hhmm: string): { hour: number; minute: number } {
  const match = HHMM_RE.exec(hhmm);
  if (!match) throw new Error(`Invalid HH:MM time: ${hhmm}`);
  const [, hh, mm] = match;
  if (hh === undefined || mm === undefined) throw new Error(`Invalid HH:MM time: ${hhmm}`);
  return { hour: Number(hh), minute: Number(mm) };
}

export interface LocalParts {
  year: number;
  /** 1-12 (unlike native `Date#getMonth`, which is 0-11). */
  month: number;
  /** Day of month, 1-31. */
  day: number;
  /** 0 = Monday .. 6 = Sunday (unlike native `Date#getDay`, which is 0=Sunday). */
  dow: number;
  /** Minutes since local midnight, 0-1439. */
  minuteOfDay: number;
  hour: number;
  minute: number;
}

/** Read the wall-clock components of an instant, as observed in `tzName`. */
export function localParts(date: Date, tzName: string): LocalParts {
  const zoned = TZDate.tz(tzName, date);
  const year = zoned.getFullYear();
  const month = zoned.getMonth() + 1;
  const day = zoned.getDate();
  const hour = zoned.getHours();
  const minute = zoned.getMinutes();
  const jsDow = zoned.getDay(); // 0 = Sunday .. 6 = Saturday
  const dow = (jsDow + 6) % 7; // 0 = Monday .. 6 = Sunday
  const minuteOfDay = hour * 60 + minute;
  return { year, month, day, dow, minuteOfDay, hour, minute };
}

/**
 * 15-minute-of-local-day bucket index, `j = floor(minuteOfDay / 15)`,
 * `j ∈ {0..95}`. `docs/ml-spec.md` §0.
 */
export function bucketOf(minuteOfDay: number): number {
  return Math.min(95, Math.max(0, Math.floor(minuteOfDay / 15)));
}

/**
 * Convert a local calendar date + `HH:MM` wall-clock time in `tzName` to the
 * UTC instant it denotes.
 */
export function zonedTimeToUtc(
  localDate: { year: number; month: number; day: number },
  hhmm: string,
  tzName: string,
): Date {
  const { hour, minute } = parseHhmm(hhmm);
  const zoned = new TZDate(
    localDate.year,
    localDate.month - 1,
    localDate.day,
    hour,
    minute,
    0,
    tzName,
  );
  return new Date(zoned.getTime());
}

/**
 * Next instant `>= now` whose local wall time in `tzName` equals `hhmm` on a
 * day whose local (Mon=0..Sun=6) weekday is in `daysOfWeek`. Searches up to 8
 * candidate local days (today + the next 7); `null` if `daysOfWeek` is empty
 * (no day can ever match) or nothing is found in that window (should not
 * happen for a non-empty `daysOfWeek`, since every weekday recurs within 7
 * days). DST-safe: day advancement uses `date-fns`'s `addDays` under the
 * `tz(tzName)` context, so it steps by calendar day, not by fixed
 * milliseconds.
 */
export function nextOccurrence(
  now: Date,
  tzName: string,
  hhmm: string,
  daysOfWeek: number[],
): Date | null {
  if (daysOfWeek.length === 0) return null;
  const allowed = new Set(daysOfWeek);
  const context = tz(tzName);

  let cursor = TZDate.tz(tzName, now);
  for (let offset = 0; offset < 8; offset++) {
    const jsDow = cursor.getDay();
    const dow = (jsDow + 6) % 7;
    if (allowed.has(dow)) {
      const candidate = zonedTimeToUtc(
        { year: cursor.getFullYear(), month: cursor.getMonth() + 1, day: cursor.getDate() },
        hhmm,
        tzName,
      );
      if (candidate.getTime() >= now.getTime()) return candidate;
    }
    cursor = addDays(cursor, 1, { in: context });
  }
  return null;
}

/** `'YYYY-MM-DD'` local calendar date string for `date`, as observed in `tzName`. */
export function localDateString(date: Date, tzName: string): string {
  const { year, month, day } = localParts(date, tzName);
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
