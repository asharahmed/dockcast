/**
 * Ontario holidays for 2026-2027, hard-coded to match EXACTLY what the Python worker uses
 * (`holidays.country_holidays("CA", subdiv="ON")`, `docs/ml-spec.md` §0: day-type `SUN` =
 * "Sunday or Ontario statutory holiday"). The two sides must agree or the API's "typical"
 * fallback would read a different `station_tod_profile` bucket than the trainer wrote.
 *
 * Generated 2026-08-18 from `holidays` (python-holidays):
 *   2026: 01-01 New Year's Day, 02-16 Family Day, 04-03 Good Friday, 05-18 Victoria Day,
 *         07-01 Canada Day, 09-07 Labour Day, 10-12 Thanksgiving, 12-25 Christmas,
 *         12-26 Boxing Day, 12-28 Boxing Day (observed)
 *   2027: 01-01 New Year's Day, 02-15 Family Day, 03-26 Good Friday, 05-24 Victoria Day,
 *         07-01 Canada Day, 09-06 Labour Day, 10-11 Thanksgiving, 12-25 Christmas,
 *         12-26 Boxing Day, 12-27 Christmas Day (observed), 12-28 Boxing Day (observed)
 * Note: the August Civic Holiday is NOT an Ontario statutory holiday and is deliberately absent.
 * Extend this list (or generate it from the Python side) before 2028.
 */
import { DAY_TYPE, localParts, type DayType } from '@dockcast/shared';

const ONTARIO_HOLIDAYS_2026_2027 = new Set<string>([
  '2026-01-01',
  '2026-02-16',
  '2026-04-03',
  '2026-05-18',
  '2026-07-01',
  '2026-09-07',
  '2026-10-12',
  '2026-12-25',
  '2026-12-26',
  '2026-12-28',
  '2027-01-01',
  '2027-02-15',
  '2027-03-26',
  '2027-05-24',
  '2027-07-01',
  '2027-09-06',
  '2027-10-11',
  '2027-12-25',
  '2027-12-26',
  '2027-12-27',
  '2027-12-28',
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
