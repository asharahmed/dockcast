/**
 * `cities` table. `docs/api.md` §2.
 */
import type { Pool } from '@dockcast/db';
import { many, maybeOne } from '@dockcast/db';

export interface CityListRow {
  slug: string;
  name: string;
  tz: string;
  lat: number;
  lon: number;
  forecasting_enabled: boolean;
  station_count: number;
  last_status_ok_at: Date | null;
}

/** `GET /cities` — active cities only, with active station counts and last successful `station_status` poll. */
export async function listCities(pool: Pool): Promise<CityListRow[]> {
  return many<CityListRow>(
    pool,
    `SELECT c.slug, c.name, c.tz, c.lat, c.lon, c.forecasting_enabled,
            (SELECT count(*)::int FROM stations s WHERE s.city_id = c.id AND s.is_active) AS station_count,
            fs.last_ok_at AS last_status_ok_at
     FROM cities c
     LEFT JOIN feed_state fs ON fs.city_id = c.id AND fs.feed = 'station_status'
     WHERE c.is_active
     ORDER BY c.name`,
  );
}

export interface CityRow {
  id: number;
  slug: string;
  name: string;
  tz: string;
  lat: number;
  lon: number;
  forecasting_enabled: boolean;
}

/** Looked up regardless of `is_active` — a paused city's detail pages should still resolve, just show stale/empty data. */
export async function getCityBySlug(pool: Pool, slug: string): Promise<CityRow | null> {
  return maybeOne<CityRow>(
    pool,
    `SELECT id, slug, name, tz, lat, lon, forecasting_enabled FROM cities WHERE slug = $1`,
    [slug],
  );
}
