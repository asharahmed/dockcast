/**
 * DB integration test (`docs/collector-spec.md` §8.4). Skipped unless
 * `DATABASE_URL_TEST` is set. Runs the full information sync + status cycle
 * + weather fetch against a throwaway database, with GBFS/Open-Meteo network
 * calls replaced by an injected `fetchImpl` serving fixture JSON.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { many, migrate, one, type Pool } from '@dockcast/db';
import pino from 'pino';
import { createPool, type CityRow } from '../src/db.js';
import { runInformationSync } from '../src/information.js';
import { runStatusCycle } from '../src/status.js';
import { runWeatherFetch } from '../src/weather.js';
import type { LastState, VehicleTypeMap } from '../src/gbfs/types.js';
import type { FetchImpl } from '../src/http.js';
import { createThrowawayDb, type ThrowawayDb } from './helpers/throwawayDb.js';

const DATABASE_URL_TEST = process.env.DATABASE_URL_TEST;

if (!DATABASE_URL_TEST) {
  console.log('Skipping cycle.db.test.ts: DATABASE_URL_TEST is not set.');
}

function loadFixture(relPath: string): unknown {
  const url = new URL(`../../../fixtures/${relPath}`, import.meta.url);
  return JSON.parse(readFileSync(fileURLToPath(url), 'utf8'));
}

const torontoV3Gbfs = loadFixture('gbfs/toronto_v3_gbfs.json');
const torontoV3StationInformation = loadFixture('gbfs/toronto_v3_station_information.json') as {
  data: { stations: { station_id: string }[] };
};
const torontoV3StationStatus = loadFixture('gbfs/toronto_v3_station_status.json') as {
  data: { stations: Record<string, unknown>[] };
};
const torontoV3VehicleTypes = loadFixture('gbfs/toronto_v3_vehicle_types.json');
const weatherForecastFixture = loadFixture('weather/openmeteo_forecast_sample.json');

const GBFS_URL = 'https://toronto.publicbikesystem.net/customer/gbfs/v3.0/gbfs.json';
const INFO_URL = 'https://toronto.publicbikesystem.net/customer/gbfs/v3.0/station_information';
const STATUS_URL = 'https://toronto.publicbikesystem.net/customer/gbfs/v3.0/station_status';
const VT_URL = 'https://toronto.publicbikesystem.net/customer/gbfs/v3.0/vehicle_types';

interface FetchEntry {
  json?: unknown;
  status?: number;
}

function makeFetch(map: Map<string, FetchEntry>): FetchImpl {
  return (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    const entry = map.get(url);
    if (!entry) return new Response(JSON.stringify({ error: 'not_found', url }), { status: 404 });
    const status = entry.status ?? 200;
    const body = entry.json !== undefined ? JSON.stringify(entry.json) : 'injected server error';
    return new Response(body, { status });
  }) as unknown as FetchImpl;
}

function baseFetchMap(statusDoc: unknown = torontoV3StationStatus): Map<string, FetchEntry> {
  return new Map<string, FetchEntry>([
    [GBFS_URL, { json: torontoV3Gbfs }],
    [INFO_URL, { json: torontoV3StationInformation }],
    [STATUS_URL, { json: statusDoc }],
    [VT_URL, { json: torontoV3VehicleTypes }],
  ]);
}

const weatherFetch: FetchImpl = (async (input: RequestInfo | URL) => {
  const url = typeof input === 'string' ? input : input.toString();
  if (url.startsWith('https://api.open-meteo.com/v1/forecast')) {
    return new Response(JSON.stringify(weatherForecastFixture), { status: 200 });
  }
  return new Response('not found', { status: 404 });
}) as unknown as FetchImpl;

const logger = pino({ level: 'silent' });

interface CountRow {
  n: number;
}

async function countOf(pool: Pool, sql: string, params: readonly unknown[]): Promise<number> {
  const row = await one<CountRow>(pool, sql, params);
  return row.n;
}

describe.skipIf(!DATABASE_URL_TEST)('collector cycles against a throwaway database', () => {
  let throwaway: ThrowawayDb;
  let pool: Pool;
  let city: CityRow;
  let idMap: Map<string, number>;
  let lastState: Map<number, LastState>;
  const vehicleTypesRef: { current: VehicleTypeMap | null } = { current: null };

  beforeAll(async () => {
    throwaway = await createThrowawayDb(DATABASE_URL_TEST as string);
    pool = createPool(throwaway.databaseUrl);
    await migrate(pool);
    city = await one<CityRow>(
      pool,
      'SELECT id, slug, gbfs_url, tz, lat, lon FROM cities WHERE slug = $1',
      ['toronto'],
    );
    idMap = new Map();
    lastState = new Map();
  }, 30_000);

  afterAll(async () => {
    await pool.end();
    await throwaway.drop();
  }, 30_000);

  it(
    'information sync creates all 1058 stations, active, and populates the id map',
    async () => {
      const result = await runInformationSync({
        pool,
        city,
        idMap,
        vehicleTypesRef,
        logger,
        now: new Date('2026-08-17T18:00:00Z'),
        fetchImpl: makeFetch(baseFetchMap()),
      });

      expect(result.ok).toBe(true);
      expect(result.n).toBe(1058);
      expect(idMap.size).toBe(1058);

      expect(await countOf(pool, 'SELECT count(*)::int AS n FROM stations WHERE city_id = $1', [city.id])).toBe(
        1058,
      );
      expect(
        await countOf(
          pool,
          'SELECT count(*)::int AS n FROM stations WHERE city_id = $1 AND is_active',
          [city.id],
        ),
      ).toBe(1058);

      expect(vehicleTypesRef.current).not.toBeNull();
      expect(vehicleTypesRef.current?.get('BOOST')).toBe('electric_assist');
    },
    20_000,
  );

  const now1 = new Date('2026-08-17T18:01:00Z');

  it(
    'first status cycle writes station_current, station_snapshots, poll_log, feed_state',
    async () => {
      const result = await runStatusCycle({
        pool,
        city,
        idMap,
        vehicleTypes: vehicleTypesRef.current,
        lastState,
        logger,
        now: now1,
        fetchImpl: makeFetch(baseFetchMap()),
      });

      expect(result.ok).toBe(true);
      expect(result.n).toBe(1058);
      expect(result.n_unknown).toBe(0);

      expect(
        await countOf(
          pool,
          'SELECT count(*)::int AS n FROM station_current sc JOIN stations s ON s.id = sc.station_pk WHERE s.city_id = $1 AND sc.ts = $2',
          [city.id, now1],
        ),
      ).toBe(1058);

      expect(
        await countOf(
          pool,
          'SELECT count(*)::int AS n FROM station_snapshots ss JOIN stations s ON s.id = ss.station_pk WHERE s.city_id = $1',
          [city.id],
        ),
      ).toBe(1058);

      const pollRows = await many<{ ok: boolean; n_items: number }>(
        pool,
        `SELECT ok, n_items FROM poll_log WHERE city_id = $1 AND feed = 'station_status' ORDER BY polled_at`,
        [city.id],
      );
      expect(pollRows).toHaveLength(1);
      expect(pollRows[0]?.ok).toBe(true);
      expect(pollRows[0]?.n_items).toBe(1058);

      const feedState = await one<{ last_ok_at: Date }>(
        pool,
        `SELECT last_ok_at FROM feed_state WHERE city_id = $1 AND feed = 'station_status'`,
        [city.id],
      );
      expect(feedState.last_ok_at).toEqual(now1);

      const pk7000 = idMap.get('7000');
      const s7000 = await one<{ bikes: number; docks: number; ebikes: number | null }>(
        pool,
        'SELECT bikes, docks, ebikes FROM station_current WHERE station_pk = $1',
        [pk7000],
      );
      expect(s7000).toEqual({ bikes: 3, docks: 44, ebikes: 0 });
    },
    20_000,
  );

  const now2 = new Date('2026-08-17T18:02:00Z');

  it(
    'second status cycle with identical data updates ts but writes no new snapshots',
    async () => {
      const result = await runStatusCycle({
        pool,
        city,
        idMap,
        vehicleTypes: vehicleTypesRef.current,
        lastState,
        logger,
        now: now2,
        fetchImpl: makeFetch(baseFetchMap()),
      });

      expect(result.ok).toBe(true);
      expect(result.n_changed).toBe(0);

      expect(
        await countOf(
          pool,
          'SELECT count(*)::int AS n FROM station_current sc JOIN stations s ON s.id = sc.station_pk WHERE s.city_id = $1 AND sc.ts = $2',
          [city.id, now2],
        ),
      ).toBe(1058);

      expect(
        await countOf(
          pool,
          'SELECT count(*)::int AS n FROM station_snapshots ss JOIN stations s ON s.id = ss.station_pk WHERE s.city_id = $1',
          [city.id],
        ),
      ).toBe(1058);

      expect(
        await countOf(
          pool,
          `SELECT count(*)::int AS n FROM poll_log WHERE city_id = $1 AND feed = 'station_status'`,
          [city.id],
        ),
      ).toBe(2);
    },
    20_000,
  );

  const now3 = new Date('2026-08-17T18:03:00Z');
  const MUTATED_BIKES = 9;

  it(
    'mutating one station adds exactly one new snapshot with the new value',
    async () => {
      const mutatedStatus = structuredClone(torontoV3StationStatus);
      const station = mutatedStatus.data.stations.find((s) => s.station_id === '7002');
      if (!station) throw new Error('fixture is missing station 7002');
      station.num_vehicles_available = MUTATED_BIKES;

      const result = await runStatusCycle({
        pool,
        city,
        idMap,
        vehicleTypes: vehicleTypesRef.current,
        lastState,
        logger,
        now: now3,
        fetchImpl: makeFetch(baseFetchMap(mutatedStatus)),
      });

      expect(result.ok).toBe(true);
      expect(result.n_changed).toBe(1);

      expect(
        await countOf(
          pool,
          'SELECT count(*)::int AS n FROM station_snapshots ss JOIN stations s ON s.id = ss.station_pk WHERE s.city_id = $1',
          [city.id],
        ),
      ).toBe(1059);

      const pk7002 = idMap.get('7002');
      const newSnaps = await many<{ bikes: number }>(
        pool,
        'SELECT bikes FROM station_snapshots WHERE station_pk = $1 AND ts = $2',
        [pk7002, now3],
      );
      expect(newSnaps).toHaveLength(1);
      expect(newSnaps[0]?.bikes).toBe(MUTATED_BIKES);

      const current7002 = await one<{ bikes: number; ts: Date }>(
        pool,
        'SELECT bikes, ts FROM station_current WHERE station_pk = $1',
        [pk7002],
      );
      expect(current7002.bikes).toBe(MUTATED_BIKES);
      expect(current7002.ts).toEqual(now3);
    },
    20_000,
  );

  const now4 = new Date('2026-08-17T18:04:00Z');

  it(
    'a failing station_status fetch writes poll_log(ok=false) and feed_state.last_error, leaves station_current/last_ok_at untouched',
    async () => {
      const failMap = baseFetchMap();
      failMap.set(STATUS_URL, { status: 500 });

      const result = await runStatusCycle({
        pool,
        city,
        idMap,
        vehicleTypes: vehicleTypesRef.current,
        lastState,
        logger,
        now: now4,
        fetchImpl: makeFetch(failMap),
      });

      expect(result.ok).toBe(false);
      expect(result.error).toBeTruthy();

      const lastPoll = await one<{ ok: boolean; error: string | null }>(
        pool,
        `SELECT ok, error FROM poll_log WHERE city_id = $1 AND feed = 'station_status' ORDER BY polled_at DESC LIMIT 1`,
        [city.id],
      );
      expect(lastPoll.ok).toBe(false);
      expect(lastPoll.error).toBeTruthy();

      const feedState = await one<{ last_ok_at: Date; last_error: string | null }>(
        pool,
        `SELECT last_ok_at, last_error FROM feed_state WHERE city_id = $1 AND feed = 'station_status'`,
        [city.id],
      );
      expect(feedState.last_ok_at).toEqual(now3);
      expect(feedState.last_error).toBeTruthy();

      const pk7002 = idMap.get('7002');
      const current7002 = await one<{ bikes: number; ts: Date }>(
        pool,
        'SELECT bikes, ts FROM station_current WHERE station_pk = $1',
        [pk7002],
      );
      expect(current7002.bikes).toBe(MUTATED_BIKES);
      expect(current7002.ts).toEqual(now3);
    },
    20_000,
  );

  const REMOVED_STATION_ID = '7014';
  const now5 = new Date('2026-08-17T18:05:00Z');

  it(
    'information sync with one station removed deactivates only that station',
    async () => {
      const trimmedInfo = structuredClone(torontoV3StationInformation);
      trimmedInfo.data.stations = trimmedInfo.data.stations.filter(
        (s) => s.station_id !== REMOVED_STATION_ID,
      );

      const map = baseFetchMap();
      map.set(INFO_URL, { json: trimmedInfo });

      const result = await runInformationSync({
        pool,
        city,
        idMap,
        vehicleTypesRef,
        logger,
        now: now5,
        fetchImpl: makeFetch(map),
      });

      expect(result.ok).toBe(true);
      expect(result.n).toBe(1057);

      const removed = await one<{ is_active: boolean }>(
        pool,
        'SELECT is_active FROM stations WHERE city_id = $1 AND station_id = $2',
        [city.id, REMOVED_STATION_ID],
      );
      expect(removed.is_active).toBe(false);

      const still = await one<{ is_active: boolean }>(
        pool,
        'SELECT is_active FROM stations WHERE city_id = $1 AND station_id = $2',
        [city.id, '7000'],
      );
      expect(still.is_active).toBe(true);

      // Id map is rebuilt including inactive stations.
      expect(idMap.size).toBe(1058);
      expect(idMap.has(REMOVED_STATION_ID)).toBe(true);
    },
    20_000,
  );

  const weatherNow = new Date('2026-08-17T18:06:00Z');

  it(
    'weather fetch writes 72 rows; a re-run with the same fetched_at adds none',
    async () => {
      const first = await runWeatherFetch({ pool, city, logger, now: weatherNow, fetchImpl: weatherFetch });
      expect(first.ok).toBe(true);
      expect(first.n).toBe(72);

      expect(
        await countOf(pool, 'SELECT count(*)::int AS n FROM weather_forecasts WHERE city_id = $1', [city.id]),
      ).toBe(72);

      const second = await runWeatherFetch({ pool, city, logger, now: weatherNow, fetchImpl: weatherFetch });
      expect(second.ok).toBe(true);

      expect(
        await countOf(pool, 'SELECT count(*)::int AS n FROM weather_forecasts WHERE city_id = $1', [city.id]),
      ).toBe(72);

      const firstHour = await one<{ valid_hour: Date }>(
        pool,
        'SELECT valid_hour FROM weather_forecasts WHERE city_id = $1 ORDER BY valid_hour ASC LIMIT 1',
        [city.id],
      );
      expect(firstHour.valid_hour).toEqual(new Date('2026-08-17T00:00:00Z'));

      expect(
        await countOf(
          pool,
          `SELECT count(*)::int AS n FROM poll_log WHERE city_id = $1 AND feed = 'weather' AND ok = true`,
          [city.id],
        ),
      ).toBe(2);
    },
    20_000,
  );
});
