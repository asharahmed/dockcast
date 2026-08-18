/**
 * Queries backing the alert scheduler (`src/alerts/scheduler.ts`).
 * `docs/api.md` §8.
 */
import type { Pool } from '@dockcast/db';
import { many, none } from '@dockcast/db';

export interface AlertableCityRow {
  id: number;
  tz: string;
}

/** Cities the scheduler considers — `docs/api.md` §8: "For each active city with forecasting_enabled". */
export async function listAlertableCities(pool: Pool): Promise<AlertableCityRow[]> {
  return many<AlertableCityRow>(
    pool,
    `SELECT id, tz FROM cities WHERE is_active AND forecasting_enabled`,
  );
}

export interface AlertCommuteRow {
  id: string;
  user_id: string;
  origin_station_pk: number;
  origin_name: string;
  dest_station_pk: number;
  dest_name: string;
  /** `'HH:MM'` (formatted in SQL, matching `commutes.queries.ts`'s convention). */
  depart_local_time: string;
  ride_minutes: number;
  threshold: number;
}

/**
 * `docs/api.md` §8 step 2: `alert_enabled`, today's local weekday in
 * `days_of_week`, `depart_local_time - alert_lead_minutes` (minute-of-day)
 * equals `nowMinuteOfDay`, and no `alert_events` row yet for
 * `(commute_id, todayDate)`.
 */
export async function listDueCommutes(
  pool: Pool,
  args: { cityId: number; todayDow: number; nowMinuteOfDay: number; todayDate: string },
): Promise<AlertCommuteRow[]> {
  return many<AlertCommuteRow>(
    pool,
    `SELECT c.id, c.user_id, c.origin_station_pk, os.name AS origin_name,
            c.dest_station_pk, ds.name AS dest_name,
            to_char(c.depart_local_time, 'HH24:MI') AS depart_local_time,
            c.ride_minutes, c.threshold
     FROM commutes c
     JOIN stations os ON os.id = c.origin_station_pk
     JOIN stations ds ON ds.id = c.dest_station_pk
     WHERE c.city_id = $1
       AND c.alert_enabled
       AND $2 = ANY(c.days_of_week)
       AND (extract(hour FROM c.depart_local_time)::int * 60
            + extract(minute FROM c.depart_local_time)::int
            - c.alert_lead_minutes) = $3
       AND NOT EXISTS (
         SELECT 1 FROM alert_events ae WHERE ae.commute_id = c.id AND ae.local_date = $4::date
       )`,
    [args.cityId, args.todayDow, args.nowMinuteOfDay, args.todayDate],
  );
}

export async function insertAlertEvent(
  pool: Pool,
  args: { commuteId: string; localDate: string; kind: string; payload: unknown; delivered: number },
): Promise<void> {
  await none(
    pool,
    `INSERT INTO alert_events (commute_id, local_date, kind, payload, delivered)
     VALUES ($1, $2::date, $3, $4::jsonb, $5)`,
    [args.commuteId, args.localDate, args.kind, JSON.stringify(args.payload), args.delivered],
  );
}
