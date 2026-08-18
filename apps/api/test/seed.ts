/**
 * Seeds a throwaway test database with Toronto stations from the GBFS
 * fixtures plus a handful of hand-crafted "synthetic" stations that give
 * deterministic control over geometry (for `alternatives()` radius/ordering
 * tests) and forecast values (for `lookup()`/`/trip` verdict tests).
 *
 * Two clocks are in play, deliberately:
 * - `FIXED_NOW` — the injectable app clock (`createApp({ now: () => FIXED_NOW })`).
 *   All forecast/lookup/history logic in `src/` is threaded through this, so
 *   tests using it are fully deterministic regardless of wall-clock time.
 * - real wall-clock time (`new Date()`) — `station_state_fresh` (used for
 *   `current`/`is_fresh`) is computed by a SQL view that hardcodes `now()`,
 *   so freshness-sensitive rows (`station_current`, `feed_state`) must be
 *   seeded relative to the actual moment the test runs, not `FIXED_NOW`.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Pool } from '@dockcast/db';
import { many, none, one } from '@dockcast/db';
import { HORIZONS } from '@dockcast/shared';

function findRepoRoot(startDir: string): string {
  let dir = startDir;
  for (;;) {
    try {
      readFileSync(join(dir, 'pnpm-workspace.yaml'));
      return dir;
    } catch {
      const parent = dirname(dir);
      if (parent === dir) throw new Error(`Could not locate repo root from ${startDir}`);
      dir = parent;
    }
  }
}

const REPO_ROOT = findRepoRoot(dirname(fileURLToPath(import.meta.url)));

/** Fixed app-clock instant used across the suite: Tue 2026-03-10 09:00 America/Toronto (EDT), a plain weekday. */
export const FIXED_NOW = new Date('2026-03-10T13:00:00.000Z');

interface GbfsName {
  text: string;
  language: string;
}
interface StationInformationEntry {
  station_id: string;
  name: GbfsName[];
  lat: number;
  lon: number;
  capacity?: number;
}
interface StationStatusEntry {
  station_id: string;
  num_vehicles_available: number;
  num_vehicles_disabled: number;
  num_docks_available: number;
  num_docks_disabled: number;
  last_reported: string;
  is_installed: boolean;
  is_renting: boolean;
  is_returning: boolean;
}

function loadFixture<T>(relPath: string): T {
  const raw = readFileSync(join(REPO_ROOT, relPath), 'utf8');
  return JSON.parse(raw) as T;
}

function englishName(names: GbfsName[]): string {
  return names.find((n) => n.language === 'en')?.text ?? names[0]?.text ?? 'Unnamed';
}

export interface SeededStation {
  id: number;
  stationId: string;
  name: string;
  lat: number;
  lon: number;
}

export interface SeededData {
  cityId: number;
  citySlug: string;
  cityTz: string;
  otherCityId: number;
  otherCitySlug: string;
  otherCityStation: SeededStation;
  /** ~50 real Toronto stations from the GBFS fixture; fresh current, no forecasts. */
  realStations: SeededStation[];
  /** Full 6-horizon forecasts, fresh current, a full typical profile, 3 neighbors (near1-3). */
  hub: SeededStation;
  near1: SeededStation;
  near2: SeededStation;
  near3: SeededStation;
  /** >600m from the hub cluster — must never appear in the hub's `alternatives`. */
  far1: SeededStation;
  /** Active, fresh current, zero `forecasts_latest` rows. */
  noForecastStation: SeededStation;
  /** Active; `forecasts_latest` rows exist for all 6 horizons but p_bike/p_dock are NULL, reason='not_fresh'. */
  unavailableStation: SeededStation;
  /** Full valid forecasts, but `station_current.last_reported` is stale (>10 min old). */
  staleCurrentStation: SeededStation;
  modelVersionGbmId: number;
  modelVersionBdId: number;
  now: Date;
}

async function insertStation(
  pool: Pool,
  args: {
    cityId: number;
    stationId: string;
    name: string;
    lat: number;
    lon: number;
    capacity: number | null;
  },
): Promise<SeededStation> {
  const row = await one<{ id: number }>(
    pool,
    `INSERT INTO stations (city_id, station_id, name, lat, lon, capacity, is_active)
     VALUES ($1, $2, $3, $4, $5, $6, true)
     RETURNING id`,
    [args.cityId, args.stationId, args.name, args.lat, args.lon, args.capacity],
  );
  return { id: row.id, stationId: args.stationId, name: args.name, lat: args.lat, lon: args.lon };
}

async function insertStationCurrent(
  pool: Pool,
  args: {
    stationPk: number;
    bikes: number;
    docks: number;
    ts: Date;
    lastReported: Date;
    installed?: boolean;
    renting?: boolean;
    returning?: boolean;
  },
): Promise<void> {
  await none(
    pool,
    `INSERT INTO station_current
       (station_pk, ts, bikes, docks, ebikes, bikes_disabled, docks_disabled, is_installed, is_renting, is_returning, last_reported)
     VALUES ($1, $2, $3, $4, NULL, 0, 0, $5, $6, $7, $8)`,
    [
      args.stationPk,
      args.ts,
      args.bikes,
      args.docks,
      args.installed ?? true,
      args.renting ?? true,
      args.returning ?? true,
      args.lastReported,
    ],
  );
}

interface ForecastSeed {
  p_bike: number[] | null[];
  p_dock: number[] | null[];
  exp_bikes: (number | null)[];
  tier: string;
  reason: string | null;
}

async function insertForecasts(
  pool: Pool,
  stationPk: number,
  t0: Date,
  seed: ForecastSeed,
): Promise<void> {
  await Promise.all(
    HORIZONS.map((h, i) => {
      const validAt = new Date(t0.getTime() + h * 60_000);
      return none(
        pool,
        `INSERT INTO forecasts_latest (station_pk, horizon, t0, valid_at, p_bike, p_dock, exp_bikes, q10, q90, tier, model_version_id, reason)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NULL, NULL, $8, NULL, $9)`,
        [
          stationPk,
          h,
          t0,
          validAt,
          seed.p_bike[i] ?? null,
          seed.p_dock[i] ?? null,
          seed.exp_bikes[i],
          seed.tier,
          seed.reason,
        ],
      );
    }),
  );
}

async function insertTypicalProfile(
  pool: Pool,
  stationPk: number,
  dayType: number,
  pBike: number,
  pDock: number,
): Promise<void> {
  const buckets = Array.from({ length: 96 }, (_, j) => j);
  await Promise.all(
    buckets.map((bucket) =>
      none(
        pool,
        `INSERT INTO station_tod_profile (station_pk, day_type, bucket, mean_fill, p_bike, p_dock, n, built_for)
         VALUES ($1, $2, $3, $4, $5, $6, 50, $7)`,
        [stationPk, dayType, bucket, (pBike + pDock) / 2, pBike, pDock, '2026-03-10'],
      ),
    ),
  );
}

function metricsValJson(refTier: 'bd_raw' | 'bd_cal' | null): string {
  return JSON.stringify({
    n_val: 10000,
    brier: { bike: 0.12, dock: 0.14 },
    logloss: { bike: 0.35, dock: 0.38 },
    auc: { bike: 0.82, dock: 0.79 },
    ece: { bike: 0.03, dock: 0.04 },
    mae: 1.2,
    rmse: 1.8,
    brier_at_risk: { bike: 0.18, dock: 0.2 },
    ref: refTier
      ? { tier: refTier, brier: { bike: 0.15, dock: 0.17 }, mae: 1.4 }
      : { tier: null, brier: null, mae: null },
  });
}

function gateJson(): string {
  return JSON.stringify({
    passed: true,
    checks: [
      { name: 'brier_bike_vs_ref', value: 0.12, threshold: 0.1425, ok: true },
      { name: 'brier_dock_vs_ref', value: 0.14, threshold: 0.1615, ok: true },
      { name: 'ece_bike', value: 0.03, threshold: 0.05, ok: true },
      { name: 'ece_dock', value: 0.04, threshold: 0.05, ok: true },
      { name: 'mae_vs_ref', value: 1.2, threshold: 1.4, ok: true },
    ],
  });
}

export async function seed(pool: Pool): Promise<SeededData> {
  const city = await one<{ id: number; slug: string; tz: string }>(
    pool,
    `SELECT id, slug, tz FROM cities WHERE slug = 'toronto'`,
  );

  const otherCity = await one<{ id: number }>(
    pool,
    `INSERT INTO cities (slug, name, gbfs_url, tz, lat, lon, country_code, holiday_country, holiday_subdiv, is_active, forecasting_enabled)
     VALUES ('ottawa', 'Bike Share Ottawa', 'https://example.invalid/gbfs.json', 'America/Toronto', 45.4215, -75.6972, 'CA', 'CA', 'ON', true, false)
     RETURNING id`,
  );
  const otherCityStation = await insertStation(pool, {
    cityId: otherCity.id,
    stationId: 'ottawa-1',
    name: 'Ottawa Test Station',
    lat: 45.4215,
    lon: -75.6972,
    capacity: 20,
  });
  await insertStationCurrent(pool, {
    stationPk: otherCityStation.id,
    bikes: 5,
    docks: 5,
    ts: new Date(),
    lastReported: new Date(),
  });
  await none(
    pool,
    `INSERT INTO feed_state (city_id, feed, last_attempt_at, last_ok_at) VALUES ($1, 'station_status', now(), now())`,
    [otherCity.id],
  );

  const info = loadFixture<{ data: { stations: StationInformationEntry[] } }>(
    'fixtures/gbfs/toronto_v3_station_information.json',
  );
  const status = loadFixture<{ data: { stations: StationStatusEntry[] } }>(
    'fixtures/gbfs/toronto_v3_station_status.json',
  );
  const statusById = new Map(status.data.stations.map((s) => [s.station_id, s]));

  const realNow = new Date();
  const realStations: SeededStation[] = await Promise.all(
    info.data.stations.slice(0, 50).map(async (entry) => {
      const station = await insertStation(pool, {
        cityId: city.id,
        stationId: entry.station_id,
        name: englishName(entry.name),
        lat: entry.lat,
        lon: entry.lon,
        capacity: entry.capacity ?? null,
      });
      const s = statusById.get(entry.station_id);
      if (s) {
        await insertStationCurrent(pool, {
          stationPk: station.id,
          bikes: s.num_vehicles_available,
          docks: s.num_docks_available,
          ts: realNow,
          lastReported: realNow,
          installed: s.is_installed,
          renting: s.is_renting,
          returning: s.is_returning,
        });
      }
      return station;
    }),
  );

  await none(
    pool,
    `INSERT INTO feed_state (city_id, feed, last_attempt_at, last_ok_at) VALUES ($1, 'station_status', $2, $2)
     ON CONFLICT (city_id, feed) DO UPDATE SET last_attempt_at = EXCLUDED.last_attempt_at, last_ok_at = EXCLUDED.last_ok_at`,
    [city.id, realNow],
  );

  // --- synthetic cluster: hub + near1-3 (all mutually <400m) + far1 (>1km from all) ---
  const hub = await insertStation(pool, {
    cityId: city.id,
    stationId: 'synthetic-hub',
    name: 'Synthetic Hub',
    lat: 43.66,
    lon: -79.385,
    capacity: 20,
  });
  const near1 = await insertStation(pool, {
    cityId: city.id,
    stationId: 'synthetic-near1',
    name: 'Synthetic Near 1',
    lat: 43.6615,
    lon: -79.385,
    capacity: 20,
  });
  const near2 = await insertStation(pool, {
    cityId: city.id,
    stationId: 'synthetic-near2',
    name: 'Synthetic Near 2',
    lat: 43.66,
    lon: -79.383,
    capacity: 20,
  });
  const near3 = await insertStation(pool, {
    cityId: city.id,
    stationId: 'synthetic-near3',
    name: 'Synthetic Near 3',
    lat: 43.6588,
    lon: -79.3865,
    capacity: 20,
  });
  const far1 = await insertStation(pool, {
    cityId: city.id,
    stationId: 'synthetic-far1',
    name: 'Synthetic Far 1',
    lat: 43.671,
    lon: -79.385,
    capacity: 20,
  });

  for (const s of [hub, near1, near2, near3, far1]) {
    await insertStationCurrent(pool, {
      stationPk: s.id,
      bikes: 4,
      docks: 4,
      ts: realNow,
      lastReported: realNow,
    });
  }

  const t0 = new Date(Math.floor(FIXED_NOW.getTime() / (5 * 60_000)) * 5 * 60_000);

  await insertForecasts(pool, hub.id, t0, {
    p_bike: [0.95, 0.85, 0.6, 0.55, 0.3, 0.2],
    p_dock: [0.9, 0.8, 0.7, 0.65, 0.5, 0.4],
    exp_bikes: [4, 4, 3, 3, 2, 1],
    tier: 'bd_raw',
    reason: null,
  });
  await insertForecasts(pool, near1.id, t0, {
    p_bike: [0.5, 0.55, 0.6, 0.65, 0.7, 0.75],
    p_dock: [0.95, 0.9, 0.6, 0.6, 0.4, 0.1],
    exp_bikes: [3, 3, 3, 4, 4, 5],
    tier: 'bd_raw',
    reason: null,
  });
  await insertForecasts(pool, near2.id, t0, {
    p_bike: [0.9, 0.88, 0.86, 0.84, 0.82, 0.8],
    p_dock: [0.3, 0.3, 0.3, 0.3, 0.3, 0.3],
    exp_bikes: [5, 5, 5, 5, 5, 5],
    tier: 'bd_raw',
    reason: null,
  });
  await insertForecasts(pool, near3.id, t0, {
    p_bike: [0.7, 0.68, 0.66, 0.64, 0.62, 0.6],
    p_dock: [0.2, 0.2, 0.2, 0.2, 0.2, 0.2],
    exp_bikes: [2, 2, 2, 2, 2, 2],
    tier: 'bd_raw',
    reason: null,
  });
  await insertForecasts(pool, far1.id, t0, {
    p_bike: [0.99, 0.99, 0.99, 0.99, 0.99, 0.99],
    p_dock: [0.99, 0.99, 0.99, 0.99, 0.99, 0.99],
    exp_bikes: [6, 6, 6, 6, 6, 6],
    tier: 'bd_raw',
    reason: null,
  });

  await insertTypicalProfile(pool, hub.id, 0, 0.66, 0.44);

  // rank 1..3 by actual distance from hub: near1 (~167m) < near3 (~180m) < near2 (~232m)
  await none(
    pool,
    `INSERT INTO station_neighbors (station_pk, neighbor_pk, rank, distance_m) VALUES
       ($1, $2, 1, 167), ($1, $3, 2, 180), ($1, $4, 3, 232)`,
    [hub.id, near1.id, near3.id, near2.id],
  );

  // --- noForecastStation: fresh current, zero forecasts_latest rows ---
  const noForecastStation = await insertStation(pool, {
    cityId: city.id,
    stationId: 'synthetic-no-forecast',
    name: 'Synthetic No Forecast',
    lat: 43.71,
    lon: -79.41,
    capacity: 15,
  });
  await insertStationCurrent(pool, {
    stationPk: noForecastStation.id,
    bikes: 2,
    docks: 2,
    ts: realNow,
    lastReported: realNow,
  });

  // --- unavailableStation: forecasts_latest rows present but p_bike/p_dock NULL ---
  const unavailableStation = await insertStation(pool, {
    cityId: city.id,
    stationId: 'synthetic-unavailable',
    name: 'Synthetic Unavailable',
    lat: 43.72,
    lon: -79.42,
    capacity: 15,
  });
  await insertStationCurrent(pool, {
    stationPk: unavailableStation.id,
    bikes: 0,
    docks: 0,
    ts: realNow,
    lastReported: realNow,
  });
  await insertForecasts(pool, unavailableStation.id, t0, {
    p_bike: [null, null, null, null, null, null],
    p_dock: [null, null, null, null, null, null],
    exp_bikes: [null, null, null, null, null, null],
    tier: 'none',
    reason: 'not_fresh',
  });

  // --- staleCurrentStation: valid forecasts, but station_current.last_reported is 20 min stale ---
  const staleCurrentStation = await insertStation(pool, {
    cityId: city.id,
    stationId: 'synthetic-stale',
    name: 'Synthetic Stale',
    lat: 43.73,
    lon: -79.43,
    capacity: 15,
  });
  const staleReported = new Date(realNow.getTime() - 20 * 60_000);
  await insertStationCurrent(pool, {
    stationPk: staleCurrentStation.id,
    bikes: 3,
    docks: 3,
    ts: staleReported,
    lastReported: staleReported,
  });
  await insertForecasts(pool, staleCurrentStation.id, t0, {
    p_bike: [0.5, 0.5, 0.5, 0.5, 0.5, 0.5],
    p_dock: [0.5, 0.5, 0.5, 0.5, 0.5, 0.5],
    exp_bikes: [2, 2, 2, 2, 2, 2],
    tier: 'bd_raw',
    reason: null,
  });

  // --- model_versions / model_eval / model_metrics_daily / worker_runs ---
  const gbmVersion = await one<{ id: number }>(
    pool,
    `INSERT INTO model_versions
       (city_id, tier, status, feature_schema_version, trained_for_date, train_window, git_sha, hyperparams, metrics_val, gate, artifact, activated_at)
     VALUES ($1, 'gbm', 'active', 1, '2026-03-09', tstzrange('2026-01-08T00:00:00Z', '2026-03-09T00:00:00Z'), 'abc123', '{}'::jsonb, $2::jsonb, $3::jsonb, NULL, now())
     RETURNING id`,
    [city.id, metricsValJson('bd_raw'), gateJson()],
  );
  const bdVersion = await one<{ id: number }>(
    pool,
    `INSERT INTO model_versions
       (city_id, tier, status, feature_schema_version, trained_for_date, train_window, git_sha, hyperparams, metrics_val, gate, artifact, activated_at)
     VALUES ($1, 'bd', 'active', 1, '2026-03-09', tstzrange('2026-01-08T00:00:00Z', '2026-03-09T00:00:00Z'), 'abc123', '{}'::jsonb, $2::jsonb, NULL, NULL, now())
     RETURNING id`,
    [city.id, metricsValJson(null)],
  );

  await none(
    pool,
    `INSERT INTO model_eval (model_version_id, split, target, horizon, slice, metric, value) VALUES
       ($1, 'val', 'bike', 0, 'all', 'brier', 0.12),
       ($1, 'val', 'dock', 0, 'all', 'brier', 0.14),
       ($1, 'val', 'bike', 15, 'all', 'brier', 0.10),
       ($1, 'val', 'bike', 0, 'all', 'n', 10000)`,
    [gbmVersion.id],
  );

  await none(
    pool,
    `INSERT INTO model_metrics_daily (city_id, day, window_days, tier, target, horizon, slice, metric, value, n) VALUES
       ($1, '2026-03-09', 1, 'gbm_active', 'bike', 0, 'all', 'brier', 0.12, 5000),
       ($1, '2026-03-09', 1, 'gbm_active', 'dock', 0, 'all', 'brier', 0.14, 5000),
       ($1, '2026-03-09', 7, 'gbm_active', 'bike', 0, 'all', 'brier', 0.13, 35000),
       ($1, '2026-03-09', 7, 'bd_cal', 'bike', 0, 'all', 'brier', 0.15, 35000),
       ($1, '2026-03-09', 7, 'persistence', 'bike', 0, 'all', 'brier', 0.22, 35000)`,
    [city.id],
  );

  await none(
    pool,
    `INSERT INTO worker_runs (city_id, kind, started_at, finished_at, ok, summary)
     VALUES ($1, 'predict', $2, $2, true, '{}'::jsonb)`,
    [city.id, realNow],
  );

  // --- 24h of poll_log + station_snapshots history for the hub station, relative to FIXED_NOW ---
  await none(
    pool,
    `INSERT INTO poll_log (city_id, polled_at, feed, ok, n_items, latency_ms, error)
     SELECT $1, gs, 'station_status', true, 55, 120, NULL
     FROM generate_series($2::timestamptz - interval '24 hours', $2::timestamptz, interval '60 seconds') gs`,
    [city.id, FIXED_NOW],
  );
  const snapshotRows = await many<{ ts: Date }>(
    pool,
    `SELECT generate_series($1::timestamptz - interval '24 hours', $1::timestamptz, interval '30 minutes') AS ts`,
    [FIXED_NOW],
  );
  await Promise.all(
    snapshotRows.map((row, i) =>
      none(
        pool,
        `INSERT INTO station_snapshots
           (station_pk, ts, bikes, docks, ebikes, bikes_disabled, docks_disabled, is_installed, is_renting, is_returning, last_reported)
         VALUES ($1, $2, $3, $4, NULL, 0, 0, true, true, true, $2)`,
        [hub.id, row.ts, 2 + (i % 5), 18 - (i % 5)],
      ),
    ),
  );

  return {
    cityId: city.id,
    citySlug: city.slug,
    cityTz: city.tz,
    otherCityId: otherCity.id,
    otherCitySlug: 'ottawa',
    otherCityStation,
    realStations,
    hub,
    near1,
    near2,
    near3,
    far1,
    noForecastStation,
    unavailableStation,
    staleCurrentStation,
    modelVersionGbmId: gbmVersion.id,
    modelVersionBdId: bdVersion.id,
    now: FIXED_NOW,
  };
}

/**
 * WP-8 test fixtures: minimal direct-SQL helpers for auth/commutes/push/
 * scheduler test suites, which need bespoke users/commutes/subscriptions
 * beyond the read-side fixtures above (e.g. a commute timed to trigger the
 * alert scheduler at a specific clock, or a user with no real login flow).
 */

/** `password_hash` defaults to a placeholder — only real for tests that actually log in via `/auth/login`. */
export async function insertUser(
  pool: Pool,
  args: { email: string; passwordHash?: string },
): Promise<{ id: string; email: string }> {
  return one<{ id: string; email: string }>(
    pool,
    `INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id, email`,
    [args.email, args.passwordHash ?? 'unused-placeholder-hash'],
  );
}

export async function insertPushSubscription(
  pool: Pool,
  args: { userId: string; endpoint: string; p256dh?: string; auth?: string },
): Promise<{ id: string }> {
  return one<{ id: string }>(
    pool,
    `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth) VALUES ($1, $2, $3, $4) RETURNING id`,
    [args.userId, args.endpoint, args.p256dh ?? 'test-p256dh', args.auth ?? 'test-auth'],
  );
}

export interface InsertCommuteArgs {
  userId: string;
  cityId: number;
  originStationPk: number;
  destStationPk: number;
  name?: string;
  departLocalTime: string;
  rideMinutes?: number;
  daysOfWeek: number[];
  alertEnabled?: boolean;
  alertLeadMinutes?: number;
  threshold?: number;
}

export async function insertCommute(
  pool: Pool,
  args: InsertCommuteArgs,
): Promise<{ id: string }> {
  return one<{ id: string }>(
    pool,
    `INSERT INTO commutes
       (user_id, city_id, name, origin_station_pk, dest_station_pk, depart_local_time,
        ride_minutes, days_of_week, alert_enabled, alert_lead_minutes, threshold)
     VALUES ($1, $2, $3, $4, $5, $6::time, $7, $8, $9, $10, $11)
     RETURNING id`,
    [
      args.userId,
      args.cityId,
      args.name ?? 'Test commute',
      args.originStationPk,
      args.destStationPk,
      args.departLocalTime,
      args.rideMinutes ?? 10,
      args.daysOfWeek,
      args.alertEnabled ?? true,
      args.alertLeadMinutes ?? 20,
      args.threshold ?? 0.7,
    ],
  );
}
