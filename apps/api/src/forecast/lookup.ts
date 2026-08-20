/**
 * `docs/api.md` §0.1 — forecast lookup semantics, normative. Implemented
 * once here and used by `/trip`, `/commutes` (WP-8), and the alert scheduler
 * (WP-8).
 *
 * Ambiguity flagged (see the WP-7 final report): step 2's "today's day_type"
 * is read here as the day-type *of `at`* (the target instant), not of `now`,
 * matching "bucket of at" in the same sentence — using `now`'s day-type while
 * bucketing by `at`'s time-of-day would be incoherent whenever `now` and `at`
 * fall on different local days (routine for leads > 120 min).
 */
import type { Pool } from '@dockcast/db';
import { maybeOne, many } from '@dockcast/db';
import {
  MAX_LEAD,
  MIN_LEAD,
  bucketOf,
  interpolate,
  localParts,
  type LegKind,
} from '@dockcast/shared';
import { dayTypeOf, getHolidaySet } from './holidays.js';

export type LookupTarget = 'bike' | 'dock';

export interface LookupCurrent {
  bikes: number;
  docks: number;
  cap_eff: number;
  as_of: string;
  is_fresh: boolean;
}

export interface LookupResult {
  kind: LegKind;
  p: number | null;
  exp_bikes: number | null;
  tier: string | null;
  reason: string | null;
  /** Raw `(at - now)` in minutes, before the `[MIN_LEAD, MAX_LEAD]` clamp used internally. */
  leadMinutes: number;
  current: LookupCurrent | null;
}

interface ForecastRow {
  horizon: number;
  p_bike: number | null;
  p_dock: number | null;
  exp_bikes: number | null;
  tier: string;
  reason: string | null;
}

function nearestRow<R extends { horizon: number }>(rows: readonly R[], lead: number): R {
  if (rows.length === 0) throw new Error('nearestRow: rows must be non-empty');
  let best = rows[0] as R;
  for (const r of rows) {
    if (Math.abs(r.horizon - lead) < Math.abs(best.horizon - lead)) best = r;
  }
  return best;
}

async function getCurrent(pool: Pool, stationPk: number): Promise<LookupCurrent | null> {
  const row = await maybeOne<{
    bikes: number;
    docks: number;
    cap_eff: number;
    ts: Date;
    is_fresh: boolean;
  }>(
    pool,
    `SELECT bikes, docks, cap_eff, ts, is_fresh FROM station_state_fresh WHERE station_pk = $1`,
    [stationPk],
  );
  if (!row) return null;
  return {
    bikes: row.bikes,
    docks: row.docks,
    cap_eff: row.cap_eff,
    as_of: row.ts.toISOString(),
    is_fresh: row.is_fresh,
  };
}

/** `docs/api.md` §0.1 step 2 — the "typical" fallback for leads beyond `MAX_LEAD`. */
async function typicalLookup(
  pool: Pool,
  stationPk: number,
  target: LookupTarget,
  at: Date,
  tzName: string,
  holidays: ReadonlySet<string>,
): Promise<Pick<LookupResult, 'kind' | 'p' | 'exp_bikes' | 'tier' | 'reason'>> {
  const dayType = dayTypeOf(at, tzName, holidays);
  const bucket = bucketOf(localParts(at, tzName).minuteOfDay);

  const row = await maybeOne<{ p_bike: number | null; p_dock: number | null }>(
    pool,
    `SELECT p_bike, p_dock FROM station_tod_profile WHERE station_pk = $1 AND day_type = $2 AND bucket = $3`,
    [stationPk, dayType, bucket],
  );
  if (!row) {
    return { kind: 'unavailable', p: null, exp_bikes: null, tier: null, reason: 'no_profile' };
  }
  const p = target === 'bike' ? row.p_bike : row.p_dock;
  if (p === null) {
    return { kind: 'unavailable', p: null, exp_bikes: null, tier: null, reason: 'no_profile' };
  }
  return { kind: 'typical', p, exp_bikes: null, tier: null, reason: null };
}

/**
 * `docs/api.md` §0.1 `lookup(station_pk, target, at, now)`. `at`/`now` are
 * plain instants — callers (e.g. `/trip`) are responsible for clamping a
 * past `depart_at` up to `now` before calling.
 */
export async function lookup(
  pool: Pool,
  args: { stationPk: number; target: LookupTarget; at: Date; now: Date },
): Promise<LookupResult> {
  const { stationPk, target, at, now } = args;
  const leadMinutes = (at.getTime() - now.getTime()) / 60_000;

  const stationRow = await maybeOne<{
    tz: string;
    holiday_country: string;
    holiday_subdiv: string | null;
  }>(
    pool,
    `SELECT c.tz, c.holiday_country, c.holiday_subdiv
     FROM stations s JOIN cities c ON c.id = s.city_id WHERE s.id = $1`,
    [stationPk],
  );
  if (!stationRow) {
    return {
      kind: 'unavailable',
      p: null,
      exp_bikes: null,
      tier: null,
      reason: 'unknown_station',
      leadMinutes,
      current: null,
    };
  }

  const current = await getCurrent(pool, stationPk);

  if (leadMinutes > MAX_LEAD) {
    const holidays = await getHolidaySet(pool, stationRow.holiday_country, stationRow.holiday_subdiv);
    const result = await typicalLookup(pool, stationPk, target, at, stationRow.tz, holidays);
    return { ...result, leadMinutes, current };
  }

  const leadClamped = Math.min(MAX_LEAD, Math.max(MIN_LEAD, leadMinutes));

  const rows = await many<ForecastRow>(
    pool,
    `SELECT horizon, p_bike, p_dock, exp_bikes, tier, reason FROM forecasts_latest WHERE station_pk = $1 ORDER BY horizon`,
    [stationPk],
  );
  if (rows.length === 0) {
    return {
      kind: 'unavailable',
      p: null,
      exp_bikes: null,
      tier: null,
      reason: 'no_forecast',
      leadMinutes,
      current,
    };
  }

  const horizons = rows.map((r) => r.horizon);
  const pValues = rows.map((r) => (target === 'bike' ? r.p_bike : r.p_dock));
  const p = interpolate(horizons, pValues, leadClamped);
  const refRow = nearestRow(rows, leadClamped);

  if (p === null) {
    return {
      kind: 'unavailable',
      p: null,
      exp_bikes: null,
      tier: refRow.tier,
      reason: refRow.reason ?? 'not_fresh',
      leadMinutes,
      current,
    };
  }

  const expValues = rows.map((r) => r.exp_bikes);
  const expBikes = interpolate(horizons, expValues, leadClamped);

  return {
    kind: 'forecast',
    p,
    exp_bikes: expBikes,
    tier: refRow.tier,
    reason: null,
    leadMinutes,
    current,
  };
}
