/**
 * `commutes` table (joined with `cities`/`stations` for the full DTO shape).
 * `docs/api.md` §6.
 */
import type { Pool } from '@dockcast/db';
import { many, maybeOne, none, one } from '@dockcast/db';

export interface CommuteRow {
  id: string;
  user_id: string;
  city_id: number;
  city_slug: string;
  city_tz: string;
  origin_id: number;
  origin_name: string;
  origin_lat: number;
  origin_lon: number;
  dest_id: number;
  dest_name: string;
  dest_lat: number;
  dest_lon: number;
  name: string;
  /** `'HH:MM'` (formatted in SQL via `to_char`, independent of the `time` column's seconds precision). */
  depart_local_time: string;
  ride_minutes: number;
  days_of_week: number[];
  alert_enabled: boolean;
  alert_lead_minutes: number;
  threshold: number;
  created_at: Date;
  updated_at: Date;
}

const SELECT_COMMUTE = `
  SELECT c.id, c.user_id, c.city_id,
         ci.slug AS city_slug, ci.tz AS city_tz,
         os.id AS origin_id, os.name AS origin_name, os.lat AS origin_lat, os.lon AS origin_lon,
         ds.id AS dest_id, ds.name AS dest_name, ds.lat AS dest_lat, ds.lon AS dest_lon,
         c.name,
         to_char(c.depart_local_time, 'HH24:MI') AS depart_local_time,
         c.ride_minutes, c.days_of_week, c.alert_enabled, c.alert_lead_minutes, c.threshold,
         c.created_at, c.updated_at
  FROM commutes c
  JOIN cities ci ON ci.id = c.city_id
  JOIN stations os ON os.id = c.origin_station_pk
  JOIN stations ds ON ds.id = c.dest_station_pk
`;

export async function countCommutesForUser(pool: Pool, userId: string): Promise<number> {
  const row = await one<{ count: number }>(
    pool,
    `SELECT count(*)::int AS count FROM commutes WHERE user_id = $1`,
    [userId],
  );
  return row.count;
}

/** Ordered by creation so the list is stable across requests. */
export async function listCommutesForUser(pool: Pool, userId: string): Promise<CommuteRow[]> {
  return many<CommuteRow>(pool, `${SELECT_COMMUTE} WHERE c.user_id = $1 ORDER BY c.created_at`, [
    userId,
  ]);
}

export async function getCommuteById(pool: Pool, id: string): Promise<CommuteRow | null> {
  return maybeOne<CommuteRow>(pool, `${SELECT_COMMUTE} WHERE c.id = $1`, [id]);
}

export interface CommuteWriteFields {
  name: string;
  cityId: number;
  originStationPk: number;
  destStationPk: number;
  departLocalTime: string;
  rideMinutes: number;
  daysOfWeek: number[];
  alertEnabled: boolean;
  alertLeadMinutes: number;
  threshold: number;
}

export async function createCommute(
  pool: Pool,
  userId: string,
  fields: CommuteWriteFields,
): Promise<CommuteRow> {
  const inserted = await one<{ id: string }>(
    pool,
    `INSERT INTO commutes
       (user_id, city_id, name, origin_station_pk, dest_station_pk, depart_local_time,
        ride_minutes, days_of_week, alert_enabled, alert_lead_minutes, threshold)
     VALUES ($1, $2, $3, $4, $5, $6::time, $7, $8, $9, $10, $11)
     RETURNING id`,
    [
      userId,
      fields.cityId,
      fields.name,
      fields.originStationPk,
      fields.destStationPk,
      fields.departLocalTime,
      fields.rideMinutes,
      fields.daysOfWeek,
      fields.alertEnabled,
      fields.alertLeadMinutes,
      fields.threshold,
    ],
  );
  const created = await getCommuteById(pool, inserted.id);
  if (!created) throw new Error('createCommute: row not found immediately after insert');
  return created;
}

export async function updateCommute(
  pool: Pool,
  id: string,
  fields: CommuteWriteFields,
): Promise<CommuteRow> {
  await none(
    pool,
    `UPDATE commutes SET
       name = $2, city_id = $3, origin_station_pk = $4, dest_station_pk = $5,
       depart_local_time = $6::time, ride_minutes = $7, days_of_week = $8,
       alert_enabled = $9, alert_lead_minutes = $10, threshold = $11, updated_at = now()
     WHERE id = $1`,
    [
      id,
      fields.name,
      fields.cityId,
      fields.originStationPk,
      fields.destStationPk,
      fields.departLocalTime,
      fields.rideMinutes,
      fields.daysOfWeek,
      fields.alertEnabled,
      fields.alertLeadMinutes,
      fields.threshold,
    ],
  );
  const updated = await getCommuteById(pool, id);
  if (!updated) throw new Error('updateCommute: row not found immediately after update');
  return updated;
}

export async function deleteCommute(pool: Pool, id: string): Promise<void> {
  await none(pool, `DELETE FROM commutes WHERE id = $1`, [id]);
}
