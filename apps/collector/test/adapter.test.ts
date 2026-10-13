import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  discover,
  fetchStationStatus,
  normaliseDiscovery,
  normaliseStationInformation,
  normaliseStationStatus,
  normaliseVehicleTypes,
  toBool,
  toCount,
} from '../src/gbfs/adapter.js';
import { GbfsSchemaError } from '../src/gbfs/types.js';
import type { FetchImpl } from '../src/http.js';

function loadFixture(relPath: string): unknown {
  const url = new URL(`../../../fixtures/${relPath}`, import.meta.url);
  return JSON.parse(readFileSync(fileURLToPath(url), 'utf8'));
}

const torontoV3Gbfs = loadFixture('gbfs/toronto_v3_gbfs.json');
const torontoV3StationInformation = loadFixture('gbfs/toronto_v3_station_information.json');
const torontoV3StationStatus = loadFixture('gbfs/toronto_v3_station_status.json');
const torontoV3VehicleTypes = loadFixture('gbfs/toronto_v3_vehicle_types.json');
const torontoV2StationInformation = loadFixture('gbfs/toronto_v2_station_information.json');
const torontoV2StationStatus = loadFixture('gbfs/toronto_v2_station_status.json');
const citibikeV23Gbfs = loadFixture('gbfs/citibike_v23_gbfs.json');
const citibikeV23StationStatusSample = loadFixture('gbfs/citibike_v23_station_status_sample.json');
const citibikeV23VehicleTypes = loadFixture('gbfs/citibike_v23_vehicle_types.json');

function findStation(rows: { station_id: string }[], id: string) {
  const found = rows.find((r) => r.station_id === id);
  if (!found) throw new Error(`fixture is missing station ${id}`);
  return found;
}

describe('normaliseDiscovery', () => {
  it('parses a GBFS 3.0 discovery document (data.feeds[])', () => {
    const feedMap = normaliseDiscovery(torontoV3Gbfs);
    expect(feedMap.version).toBe('3.0');
    expect(feedMap.feeds.get('station_information')).toBe(
      'https://toronto.publicbikesystem.net/customer/gbfs/v3.0/station_information',
    );
    expect(feedMap.feeds.get('station_status')).toBe(
      'https://toronto.publicbikesystem.net/customer/gbfs/v3.0/station_status',
    );
    expect(feedMap.feeds.get('vehicle_types')).toBe(
      'https://toronto.publicbikesystem.net/customer/gbfs/v3.0/vehicle_types',
    );
  });

  it('parses a GBFS 2.3 discovery document (data.<lang>.feeds[], picks "en")', () => {
    const feedMap = normaliseDiscovery(citibikeV23Gbfs);
    expect(feedMap.version).toBe('2.3');
    expect(feedMap.feeds.get('station_information')).toBe(
      'https://gbfs.lyft.com/gbfs/2.3/bkn/en/station_information.json',
    );
    expect(feedMap.feeds.get('station_status')).toBe(
      'https://gbfs.lyft.com/gbfs/2.3/bkn/en/station_status.json',
    );
  });

  it('parses a synthetic GBFS 1.x document with no version field', () => {
    const doc = {
      data: {
        en: {
          feeds: [
            { name: 'station_information', url: 'https://example.test/v1/station_information.json' },
            { name: 'station_status', url: 'https://example.test/v1/station_status.json' },
          ],
        },
      },
    };
    const feedMap = normaliseDiscovery(doc);
    expect(feedMap.version).toBe('2.0');
    expect(feedMap.feeds.get('station_information')).toBe('https://example.test/v1/station_information.json');
    expect(feedMap.feeds.get('station_status')).toBe('https://example.test/v1/station_status.json');
  });

  it('throws GbfsSchemaError when station_status is missing', () => {
    const doc = {
      version: '3.0',
      data: { feeds: [{ name: 'station_information', url: 'https://example.test/station_information' }] },
    };
    expect(() => normaliseDiscovery(doc)).toThrow(GbfsSchemaError);
  });

  it('throws GbfsSchemaError when station_information is missing', () => {
    const doc = {
      version: '3.0',
      data: { feeds: [{ name: 'station_status', url: 'https://example.test/station_status' }] },
    };
    expect(() => normaliseDiscovery(doc)).toThrow(GbfsSchemaError);
  });
});

describe('discover() caching', () => {
  it('serves subsequent calls from cache within the TTL without refetching', async () => {
    let calls = 0;
    const fetchImpl: FetchImpl = (async () => {
      calls++;
      return new Response(JSON.stringify(torontoV3Gbfs), { status: 200 });
    }) as unknown as FetchImpl;

    const url = 'https://example.test/cache-1/gbfs.json';
    const t0 = new Date('2026-08-17T00:00:00Z');
    const t1 = new Date('2026-08-17T00:30:00Z'); // within 1h TTL

    await discover(url, { fetchImpl, now: t0 });
    await discover(url, { fetchImpl, now: t1 });

    expect(calls).toBe(1);
  });

  it('refetches after the TTL expires', async () => {
    let calls = 0;
    const fetchImpl: FetchImpl = (async () => {
      calls++;
      return new Response(JSON.stringify(torontoV3Gbfs), { status: 200 });
    }) as unknown as FetchImpl;

    const url = 'https://example.test/cache-2/gbfs.json';
    const t0 = new Date('2026-08-17T00:00:00Z');
    const t1 = new Date('2026-08-17T01:00:01Z'); // just past 1h TTL

    await discover(url, { fetchImpl, now: t0 });
    await discover(url, { fetchImpl, now: t1 });

    expect(calls).toBe(2);
  });

  it('falls back to the previous cache entry when a refresh fails', async () => {
    let calls = 0;
    const fetchImpl: FetchImpl = (async () => {
      calls++;
      if (calls === 1) return new Response(JSON.stringify(torontoV3Gbfs), { status: 200 });
      return new Response('server error', { status: 500 });
    }) as unknown as FetchImpl;

    const url = 'https://example.test/cache-3/gbfs.json';
    const t0 = new Date('2026-08-17T00:00:00Z');
    const t1 = new Date('2026-08-17T02:00:00Z'); // past TTL, refresh will fail

    const first = await discover(url, { fetchImpl, now: t0 });
    const second = await discover(url, { fetchImpl, now: t1 });

    expect(second).toEqual(first);
    expect(calls).toBe(2);
  });

  it('throws when there is no cache and the fetch fails', async () => {
    const fetchImpl: FetchImpl = (async () => new Response('server error', { status: 500 })) as unknown as FetchImpl;
    await expect(discover('https://example.test/cache-4/gbfs.json', { fetchImpl })).rejects.toThrow();
  });
});

describe('normaliseStationInformation (§2.2)', () => {
  it('v3: station 7000 has the exact name (internal double space preserved), lat/lon, capacity', () => {
    const { stations } = normaliseStationInformation(torontoV3StationInformation);
    const s = findStation(stations, '7000');
    expect(s.name).toBe('Fort York  Blvd / Capreol Ct');
    expect(s.lat).toBe(43.63970679931218);
    expect(s.lon).toBe(-79.39614309573555);
    expect(s.capacity).toBe(47);
  });

  it('v2: station 7000 has the same name/lat/lon/capacity as v3', () => {
    const { stations } = normaliseStationInformation(torontoV2StationInformation);
    const s = findStation(stations, '7000');
    expect(s.name).toBe('Fort York  Blvd / Capreol Ct');
    expect(s.lat).toBe(43.63970679931218);
    expect(s.lon).toBe(-79.39614309573555);
    expect(s.capacity).toBe(47);
  });

  it('skips stations with non-finite lat/lon and counts them', () => {
    const doc = {
      data: {
        stations: [
          { station_id: '1', name: 'ok', lat: 43.1, lon: -79.1 },
          { station_id: '2', name: 'bad-lat', lat: 'not-a-number', lon: -79.1 },
          { station_id: '3', name: 'bad-lon', lat: 43.1, lon: null },
        ],
      },
    };
    const { stations, n_skipped } = normaliseStationInformation(doc);
    expect(stations).toHaveLength(1);
    expect(n_skipped).toBe(2);
  });

  it('skips stations with an empty/missing station_id', () => {
    const doc = { data: { stations: [{ name: 'x', lat: 1, lon: 1 }, { station_id: '', name: 'y', lat: 1, lon: 1 }] } };
    const { stations, n_skipped } = normaliseStationInformation(doc);
    expect(stations).toHaveLength(0);
    expect(n_skipped).toBe(2);
  });

  it('trims leading/trailing whitespace from names (v3 and v2), keeping internal spacing', () => {
    const v3 = {
      data: {
        stations: [
          { station_id: '1', name: [{ text: ' Grafton Ave / Roncesvalles Ave', language: 'en' }], lat: 1, lon: 1 },
          { station_id: '2', name: [{ text: 'Fort York  Blvd ', language: 'en' }], lat: 1, lon: 1 },
        ],
      },
    };
    const v2 = { data: { stations: [{ station_id: '3', name: '  15 Price St ', lat: 1, lon: 1 }] } };
    const names = [
      ...normaliseStationInformation(v3).stations,
      ...normaliseStationInformation(v2).stations,
    ].map((s) => s.name);
    expect(names).toEqual(['Grafton Ave / Roncesvalles Ave', 'Fort York  Blvd', '15 Price St']);
  });

  it('treats a whitespace-only name as missing and falls back to station_id', () => {
    const doc = { data: { stations: [{ station_id: '77', name: '   ', lat: 1, lon: 1 }] } };
    expect(normaliseStationInformation(doc).stations[0]?.name).toBe('77');
  });

  it('defaults name to station_id when missing', () => {
    const doc = { data: { stations: [{ station_id: '42', lat: 1, lon: 1 }] } };
    const { stations } = normaliseStationInformation(doc);
    expect(stations[0]?.name).toBe('42');
  });

  it('sets capacity null for non-integer/negative values', () => {
    const doc = {
      data: {
        stations: [
          { station_id: '1', lat: 1, lon: 1, capacity: 10.5 },
          { station_id: '2', lat: 1, lon: 1, capacity: -1 },
          { station_id: '3', lat: 1, lon: 1 },
        ],
      },
    };
    const { stations } = normaliseStationInformation(doc);
    expect(stations.map((s) => s.capacity)).toEqual([null, null, null]);
  });
});

describe('toCount', () => {
  it('clamps negative numbers to 0 and reports clamped', () => {
    expect(toCount(-3)).toEqual({ value: 0, clamped: true });
  });

  it('parses numeric strings', () => {
    expect(toCount('7')).toEqual({ value: 7, clamped: false });
  });

  it('truncates fractional numbers', () => {
    expect(toCount(4.9)).toEqual({ value: 4, clamped: false });
  });

  it('returns undefined for missing/non-numeric input', () => {
    expect(toCount(undefined)).toBeUndefined();
    expect(toCount(null)).toBeUndefined();
    expect(toCount('not-a-number')).toBeUndefined();
    expect(toCount({})).toBeUndefined();
  });
});

describe('toBool', () => {
  it.each([true, 1, '1', 'true'])('%s -> true', (v) => {
    expect(toBool(v)).toBe(true);
  });

  it.each([false, 0, '0', undefined, null, 'false', 2, 'yes'])('%s -> false', (v) => {
    expect(toBool(v)).toBe(false);
  });
});

describe('normaliseStationStatus (§2.3, §2.3.1)', () => {
  const now = new Date('2026-08-17T18:00:00Z');
  const vt3 = normaliseVehicleTypes(torontoV3VehicleTypes);

  it('v3 station 7000: bikes/docks/ebikes/disabled/flags/last_reported', () => {
    const { rows } = normaliseStationStatus(torontoV3StationStatus, vt3, now);
    const s = findStation(rows, '7000');
    expect(s.bikes).toBe(3);
    expect(s.docks).toBe(44);
    expect(s.ebikes).toBe(0);
    expect(s.bikes_disabled).toBe(0);
    expect(s.docks_disabled).toBe(0);
    expect(s.is_installed).toBe(true);
    expect(s.is_renting).toBe(true);
    expect(s.is_returning).toBe(true);
    expect(s.last_reported).toEqual(new Date('2026-08-17T17:29:47.637Z'));
  });

  it('v3 station 7001: ebikes 10, bikes 11, docks 7', () => {
    const { rows } = normaliseStationStatus(torontoV3StationStatus, vt3, now);
    const s = findStation(rows, '7001');
    expect(s.ebikes).toBe(10);
    expect(s.bikes).toBe(11);
    expect(s.docks).toBe(7);
  });

  it('v2 station 7000: bikes 3, docks 44, ebikes 0, last_reported from unix seconds', () => {
    const { rows } = normaliseStationStatus(torontoV2StationStatus, null, now);
    const s = findStation(rows, '7000');
    expect(s.bikes).toBe(3);
    expect(s.docks).toBe(44);
    expect(s.ebikes).toBe(0);
    expect(s.last_reported).toEqual(new Date(1786987534 * 1000));
  });

  it('v2 station 7001: ebikes 11, bikes 12', () => {
    const { rows } = normaliseStationStatus(torontoV2StationStatus, null, now);
    const s = findStation(rows, '7001');
    expect(s.ebikes).toBe(11);
    expect(s.bikes).toBe(12);
  });

  it('field-name matrix: v3 num_vehicles_available and v2 num_bikes_available agree for station 7000', () => {
    const v3 = findStation(normaliseStationStatus(torontoV3StationStatus, vt3, now).rows, '7000');
    const v2 = findStation(normaliseStationStatus(torontoV2StationStatus, null, now).rows, '7000');
    expect(v3.bikes).toBe(v2.bikes);
    expect(v3.docks).toBe(v2.docks);
  });

  it('Citi Bike sample: first station has zero counts, all flags false, and last_reported is the injected now (86400 placeholder rule)', () => {
    const injectedNow = new Date('2026-08-17T18:30:00Z');
    const { rows } = normaliseStationStatus(citibikeV23StationStatusSample, null, injectedNow);
    const s = rows[0];
    expect(s?.station_id).toBe('2235288981858690806');
    expect(s?.bikes).toBe(0);
    expect(s?.docks).toBe(0);
    expect(s?.ebikes).toBe(0);
    expect(s?.is_installed).toBe(false);
    expect(s?.is_renting).toBe(false);
    expect(s?.is_returning).toBe(false);
    expect(s?.last_reported).toEqual(injectedNow);
  });

  it('parses all 20 Citi Bike sample rows without skipping any', () => {
    const { rows, n_skipped } = normaliseStationStatus(citibikeV23StationStatusSample, null, now);
    expect(rows).toHaveLength(20);
    expect(n_skipped).toBe(0);
  });

  describe('e-bike rules (§2.3.1)', () => {
    it('rule 1: num_ebikes_available present (Citi Bike) takes priority', () => {
      const doc = {
        data: {
          stations: [
            {
              station_id: 's1',
              num_bikes_available: 5,
              num_docks_available: 2,
              num_ebikes_available: 3,
              num_bikes_available_types: { ebike: 999 },
            },
          ],
        },
      };
      const { rows } = normaliseStationStatus(doc, null, now);
      expect(rows[0]?.ebikes).toBe(3);
    });

    it('rule 2: num_bikes_available_types.ebike (Toronto 1.x/2.x)', () => {
      const doc = {
        data: {
          stations: [
            {
              station_id: 's1',
              num_bikes_available: 5,
              num_docks_available: 2,
              num_bikes_available_types: { mechanical: 2, ebike: 3 },
            },
          ],
        },
      };
      const { rows } = normaliseStationStatus(doc, null, now);
      expect(rows[0]?.ebikes).toBe(3);
    });

    it('rule 3: vehicle_types_available summed via VehicleTypeMap (Toronto 3.0)', () => {
      const vehicleTypes = new Map([
        ['HUMAN', 'human'],
        ['ELEC', 'electric'],
        ['ASSIST', 'electric_assist'],
      ]);
      const doc = {
        data: {
          stations: [
            {
              station_id: 's1',
              num_vehicles_available: 6,
              num_docks_available: 2,
              vehicle_types_available: [
                { vehicle_type_id: 'HUMAN', count: 2 },
                { vehicle_type_id: 'ELEC', count: 3 },
                { vehicle_type_id: 'ASSIST', count: 1 },
              ],
            },
          ],
        },
      };
      const { rows } = normaliseStationStatus(doc, vehicleTypes, now);
      expect(rows[0]?.ebikes).toBe(4);
    });

    it('rule 3 unavailable: vehicle_types_available present but no VehicleTypeMap -> null', () => {
      const doc = {
        data: {
          stations: [
            {
              station_id: 's1',
              num_vehicles_available: 6,
              num_docks_available: 2,
              vehicle_types_available: [{ vehicle_type_id: 'ELEC', count: 3 }],
            },
          ],
        },
      };
      const { rows } = normaliseStationStatus(doc, null, now);
      expect(rows[0]?.ebikes).toBeNull();
    });

    it('rule 4: no applicable source -> null', () => {
      const doc = {
        data: {
          stations: [{ station_id: 's1', num_vehicles_available: 6, num_docks_available: 2 }],
        },
      };
      const { rows } = normaliseStationStatus(doc, null, now);
      expect(rows[0]?.ebikes).toBeNull();
    });
  });

  describe('last_reported cases', () => {
    it('unix seconds number', () => {
      const doc = { data: { stations: [{ station_id: 's1', num_bikes_available: 1, num_docks_available: 1, last_reported: 1786987534 }] } };
      const { rows } = normaliseStationStatus(doc, null, now);
      expect(rows[0]?.last_reported).toEqual(new Date(1786987534 * 1000));
    });

    it('RFC3339 string', () => {
      const doc = { data: { stations: [{ station_id: 's1', num_bikes_available: 1, num_docks_available: 1, last_reported: '2026-08-17T17:29:47.637Z' }] } };
      const { rows } = normaliseStationStatus(doc, null, now);
      expect(rows[0]?.last_reported).toEqual(new Date('2026-08-17T17:29:47.637Z'));
    });

    it('the 86400 placeholder maps to now', () => {
      const doc = { data: { stations: [{ station_id: 's1', num_bikes_available: 1, num_docks_available: 1, last_reported: 86400 }] } };
      const { rows } = normaliseStationStatus(doc, null, now);
      expect(rows[0]?.last_reported).toEqual(now);
    });

    it('missing last_reported maps to now', () => {
      const doc = { data: { stations: [{ station_id: 's1', num_bikes_available: 1, num_docks_available: 1 }] } };
      const { rows } = normaliseStationStatus(doc, null, now);
      expect(rows[0]?.last_reported).toEqual(now);
    });
  });

  it('drops a station missing the required bikes/docks fields and counts it', () => {
    const doc = {
      data: {
        stations: [
          { station_id: 'ok', num_bikes_available: 1, num_docks_available: 1 },
          { station_id: 'no-bikes', num_docks_available: 1 },
          { station_id: 'no-docks', num_bikes_available: 1 },
        ],
      },
    };
    const { rows, n_skipped } = normaliseStationStatus(doc, null, now);
    expect(rows).toHaveLength(1);
    expect(n_skipped).toBe(2);
  });

  it('counts n_clamped when negative counts are clamped', () => {
    const doc = {
      data: {
        stations: [{ station_id: 's1', num_bikes_available: -2, num_docks_available: 5, num_bikes_disabled: -1 }],
      },
    };
    const { rows, n_clamped } = normaliseStationStatus(doc, null, now);
    expect(rows[0]?.bikes).toBe(0);
    expect(rows[0]?.bikes_disabled).toBe(0);
    expect(n_clamped).toBe(2);
  });
});

describe('normaliseVehicleTypes', () => {
  it('parses the Toronto 3.0 fixture into a vehicle_type_id -> propulsion_type map', () => {
    const map = normaliseVehicleTypes(torontoV3VehicleTypes);
    expect(map.get('ICONIC')).toBe('human');
    expect(map.get('BOOST')).toBe('electric_assist');
    expect(map.get('EFIT')).toBe('electric_assist');
  });

  it('parses the Citi Bike 2.3 fixture', () => {
    const map = normaliseVehicleTypes(citibikeV23VehicleTypes);
    expect(map.get('1')).toBe('human');
    expect(map.get('2')).toBe('electric_assist');
  });

  it('throws GbfsSchemaError when data.vehicle_types is not an array', () => {
    expect(() => normaliseVehicleTypes({ data: {} })).toThrow(GbfsSchemaError);
  });
});

describe('fetchStationStatus (network wrapper, injectable fetch)', () => {
  it('fetches and normalises via an injected fetchImpl', async () => {
    const fetchImpl: FetchImpl = (async () =>
      new Response(JSON.stringify(torontoV3StationStatus), { status: 200 })) as unknown as FetchImpl;
    const { rows } = await fetchStationStatus('https://example.test/station_status', vt3For(), new Date(), {
      fetchImpl,
    });
    expect(findStation(rows, '7000').bikes).toBe(3);
  });
});

function vt3For() {
  return normaliseVehicleTypes(torontoV3VehicleTypes);
}
