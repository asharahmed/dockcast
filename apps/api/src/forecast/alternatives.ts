/**
 * `docs/api.md` §0.1 `alternatives(station_pk, target, at, now)`.
 */
import type { Pool } from '@dockcast/db';
import { many } from '@dockcast/db';
import { ALT_RADIUS_M, WALK_M_PER_MIN } from '@dockcast/shared';
import { lookup, type LookupTarget } from './lookup.js';

export interface AlternativeResult {
  station: { id: number; name: string; lat: number; lon: number };
  distance_m: number;
  walk_minutes: number;
  p: number | null;
  exp_bikes: number | null;
}

interface CandidateRow {
  id: number;
  name: string;
  lat: number;
  lon: number;
  distance_m: number;
}

/**
 * Active stations within `ALT_RADIUS_M` of `stationPk` (excluding itself),
 * each looked up for `target` at `at`; only `kind: 'forecast'` legs are kept,
 * sorted by `p` descending, top 3.
 */
export async function alternatives(
  pool: Pool,
  args: { stationPk: number; target: LookupTarget; at: Date; now: Date },
): Promise<AlternativeResult[]> {
  const { stationPk, target, at, now } = args;

  const candidates = await many<CandidateRow>(
    pool,
    `SELECT s2.id, s2.name, s2.lat, s2.lon, ST_Distance(s1.geom, s2.geom) AS distance_m
     FROM stations s1
     JOIN stations s2 ON s2.city_id = s1.city_id AND s2.id <> s1.id AND s2.is_active
     WHERE s1.id = $1 AND ST_DWithin(s1.geom, s2.geom, $2)
     ORDER BY distance_m`,
    [stationPk, ALT_RADIUS_M],
  );

  const results: AlternativeResult[] = [];
  for (const candidate of candidates) {
    const result = await lookup(pool, { stationPk: candidate.id, target, at, now });
    if (result.kind !== 'forecast' || result.p === null) continue;
    results.push({
      station: { id: candidate.id, name: candidate.name, lat: candidate.lat, lon: candidate.lon },
      distance_m: candidate.distance_m,
      walk_minutes: Math.ceil(candidate.distance_m / WALK_M_PER_MIN),
      p: result.p,
      exp_bikes: result.exp_bikes,
    });
  }

  results.sort((a, b) => (b.p ?? 0) - (a.p ?? 0));
  return results.slice(0, 3);
}
