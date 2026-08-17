/**
 * Ontario statutory holidays, hard-coded for 2026-2027 (`docs/plan.md`
 * WP-7 contract: "for holidays in this WP use a small helper with Ontario
 * statutory holidays for 2026-2027 hard-coded"; `docs/ml-spec.md` §0 day-type
 * `SUN` = "Sunday or Ontario statutory holiday", from `holidays.CA(subdiv="ON")`
 * in the Python worker — this is a small, deliberately non-general port of
 * the same 10 fixed-date/nth-weekday holidays for the two years the service
 * needs today, not a calendar library).
 *
 * Dates (computed from the standard rules, not looked up per-year):
 * - New Year's Day: Jan 1
 * - Family Day: 3rd Monday of February
 * - Good Friday: the Friday before Easter Sunday
 * - Victoria Day: the Monday on/before May 24
 * - Canada Day: Jul 1
 * - Civic Holiday: 1st Monday of August
 * - Labour Day: 1st Monday of September
 * - Thanksgiving: 2nd Monday of October
 * - Christmas: Dec 25
 * - Boxing Day: Dec 26
 *
 * 2026: Jan 1 (Thu), Feb 16, Apr 3 (Good Friday), May 18, Jul 1 (Wed), Aug 3,
 * Sep 7, Oct 12, Dec 25 (Fri), Dec 26 (Sat).
 * 2027: Jan 1 (Fri), Feb 15, Mar 26 (Good Friday), May 24, Jul 1 (Thu), Aug 2,
 * Sep 6, Oct 11, Dec 25 (Sat), Dec 26 (Sun).
 */
import { DAY_TYPE, localParts, type DayType } from '@dockcast/shared';

const ONTARIO_HOLIDAYS_2026_2027 = new Set<string>([
  '2026-01-01',
  '2026-02-16',
  '2026-04-03',
  '2026-05-18',
  '2026-07-01',
  '2026-08-03',
  '2026-09-07',
  '2026-10-12',
  '2026-12-25',
  '2026-12-26',
  '2027-01-01',
  '2027-02-15',
  '2027-03-26',
  '2027-05-24',
  '2027-07-01',
  '2027-08-02',
  '2027-09-06',
  '2027-10-11',
  '2027-12-25',
  '2027-12-26',
]);

function localDateKey(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function isOntarioHoliday(year: number, month: number, day: number): boolean {
  return ONTARIO_HOLIDAYS_2026_2027.has(localDateKey(year, month, day));
}

/**
 * `docs/ml-spec.md` §0 day-type: `0=WD` (Mon-Fri non-holiday), `1=SAT`,
 * `2=SUN` (Sunday or Ontario statutory holiday), for the local calendar day
 * of `date` in `tzName`.
 */
export function dayTypeOf(date: Date, tzName: string): DayType {
  const parts = localParts(date, tzName);
  if (isOntarioHoliday(parts.year, parts.month, parts.day)) return DAY_TYPE.SUN;
  if (parts.dow === 5) return DAY_TYPE.SAT; // localParts: 0=Mon..6=Sun, so Saturday=5
  if (parts.dow === 6) return DAY_TYPE.SUN;
  return DAY_TYPE.WD;
}
