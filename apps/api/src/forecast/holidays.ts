/**
 * Day-typing against the `holiday_calendar` table (docs/ml-spec.md §0:
 * day-type `SUN` = "Sunday or statutory holiday" for the city's region).
 *
 * The table is written by the ML worker (`holidays_refresh` during bootstrap,
 * nightly train, and `add-city`) from python-holidays, so both sides read the
 * same dates for every (country, subdiv) a city declares — the API previously
 * hard-coded Ontario 2026-27, which silently mistyped days for any other
 * region. Migration 0004 seeds CA/ON so existing deployments don't regress
 * before their first worker refresh.
 *
 * The whole table (a few hundred rows) is cached in-process per pool and
 * reloaded after {@link TTL_MS}, so a nightly refresh is visible within hours.
 */
import type { Pool } from '@dockcast/db';
import { many } from '@dockcast/db';
import { DAY_TYPE, localParts, type DayType } from '@dockcast/shared';

const TTL_MS = 6 * 60 * 60 * 1000;

const EMPTY: ReadonlySet<string> = new Set();

interface CacheEntry {
  loadedAt: number;
  byRegion: Map<string, Set<string>>;
}

const cache = new WeakMap<Pool, CacheEntry>();

function regionKey(country: string, subdiv: string | null): string {
  return `${country}|${subdiv ?? ''}`;
}

/**
 * The 'YYYY-MM-DD' holiday dates for one (country, subdiv) region. Unknown
 * regions resolve to the empty set — day-typing then treats every weekday as
 * `WD`, which is also the correct behaviour for a region with no holidays
 * loaded yet.
 */
export async function getHolidaySet(
  pool: Pool,
  country: string,
  subdiv: string | null,
  nowMs: number = Date.now(),
): Promise<ReadonlySet<string>> {
  let entry = cache.get(pool);
  if (!entry || nowMs - entry.loadedAt > TTL_MS) {
    const rows = await many<{ holiday_country: string; holiday_subdiv: string; day: string }>(
      pool,
      `SELECT holiday_country, holiday_subdiv, day::text AS day FROM holiday_calendar`,
    );
    const byRegion = new Map<string, Set<string>>();
    for (const row of rows) {
      const key = regionKey(row.holiday_country, row.holiday_subdiv === '' ? null : row.holiday_subdiv);
      let set = byRegion.get(key);
      if (!set) {
        set = new Set();
        byRegion.set(key, set);
      }
      set.add(row.day);
    }
    entry = { loadedAt: nowMs, byRegion };
    cache.set(pool, entry);
  }
  return entry.byRegion.get(regionKey(country, subdiv)) ?? EMPTY;
}

function localDateKey(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * `docs/ml-spec.md` §0 day-type: `0=WD` (Mon-Fri non-holiday), `1=SAT`,
 * `2=SUN` (Sunday or statutory holiday), for the local calendar day of
 * `date` in `tzName`, judged against the caller's regional `holidays` set
 * (from {@link getHolidaySet}).
 */
export function dayTypeOf(date: Date, tzName: string, holidays: ReadonlySet<string>): DayType {
  const parts = localParts(date, tzName);
  if (holidays.has(localDateKey(parts.year, parts.month, parts.day))) return DAY_TYPE.SUN;
  if (parts.dow === 5) return DAY_TYPE.SAT; // localParts: 0=Mon..6=Sun, so Saturday=5
  if (parts.dow === 6) return DAY_TYPE.SUN;
  return DAY_TYPE.WD;
}
