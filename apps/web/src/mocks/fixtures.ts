/**
 * MSW fixture DTOs, conforming to `@dockcast/shared`'s zod schemas
 * (validated by `test/mocks.test.ts`). ui-spec.md §1: "build against MSW
 * handlers... that serve fixture DTOs conforming to the shared zod schemas."
 */
import type {
  CityListResponse,
  StationListResponse,
  MapResponse,
  StationDetailResponse,
  StationHistoryResponse,
  HealthResponse,
  UserResponse,
} from '../api/types.js';

export const cityFixture = {
  slug: 'toronto',
  name: 'Bike Share Toronto',
  tz: 'America/Toronto',
  lat: 43.6532,
  lon: -79.3832,
  forecasting_enabled: true,
  station_count: 3,
  last_status_ok_at: '2026-08-17T12:00:00Z',
};

export const cityListResponseFixture: CityListResponse = { cities: [cityFixture] };

const stationList = [
  { id: 1, station_id: '7000', name: 'Union Station', lat: 43.6453, lon: -79.3806, capacity: 30 },
  {
    id: 2,
    station_id: '7001',
    name: 'Yonge / Wellesley',
    lat: 43.6659,
    lon: -79.3835,
    capacity: 24,
  },
  { id: 3, station_id: '7002', name: 'Bay / College', lat: 43.6598, lon: -79.3894, capacity: 20 },
];

export const stationListResponseFixture: StationListResponse = { stations: stationList };

export const mapResponseFixture: MapResponse = {
  t0: '2026-08-17T12:00:00Z',
  as_of: '2026-08-17T12:00:30Z',
  horizons: [15, 30, 45, 60, 90, 120],
  stations: [
    {
      id: 1,
      b: 5,
      d: 10,
      c: 15,
      fresh: true,
      f: [
        [0.82, 0.41, 4.1],
        [0.75, 0.5, 3.8],
        [0.7, 0.55, 3.5],
        [0.65, 0.6, 3.2],
        [0.55, 0.7, 2.7],
        [0.45, 0.8, 2.1],
      ],
    },
    {
      id: 2,
      b: 0,
      d: 24,
      c: 24,
      fresh: true,
      f: [null, null, null, null, null, null],
    },
    {
      id: 3,
      b: 2,
      d: 18,
      c: 20,
      fresh: false,
      f: [null, null, null, null, null, null],
    },
  ],
};

export const stationDetailResponseFixture: StationDetailResponse = {
  station: {
    id: 1,
    station_id: '7000',
    name: 'Union Station',
    lat: 43.6453,
    lon: -79.3806,
    capacity: 30,
    city: { slug: 'toronto', name: 'Bike Share Toronto', tz: 'America/Toronto' },
  },
  current: {
    bikes: 5,
    docks: 10,
    ebikes: 2,
    cap_eff: 15,
    is_fresh: true,
    as_of: '2026-08-17T12:00:00Z',
    last_reported: '2026-08-17T11:59:30Z',
  },
  forecasts: [
    {
      horizon: 15,
      valid_at: '2026-08-17T12:15:00Z',
      p_bike: 0.82,
      p_dock: 0.41,
      exp_bikes: 4.1,
      q10: 2,
      q90: 7,
      tier: 'bd_raw',
      reason: null,
    },
    {
      horizon: 30,
      valid_at: '2026-08-17T12:30:00Z',
      p_bike: 0.75,
      p_dock: 0.5,
      exp_bikes: 3.8,
      q10: 2,
      q90: 6,
      tier: 'bd_raw',
      reason: null,
    },
    {
      horizon: 45,
      valid_at: '2026-08-17T12:45:00Z',
      p_bike: null,
      p_dock: null,
      exp_bikes: null,
      q10: null,
      q90: null,
      tier: 'none',
      reason: 'not_fresh',
    },
    {
      horizon: 60,
      valid_at: '2026-08-17T13:00:00Z',
      p_bike: 0.65,
      p_dock: 0.6,
      exp_bikes: 3.2,
      q10: 1,
      q90: 6,
      tier: 'bd_raw',
      reason: null,
    },
    {
      horizon: 90,
      valid_at: '2026-08-17T13:30:00Z',
      p_bike: 0.55,
      p_dock: 0.7,
      exp_bikes: 2.7,
      q10: 1,
      q90: 5,
      tier: 'bd_raw',
      reason: null,
    },
    {
      horizon: 120,
      valid_at: '2026-08-17T14:00:00Z',
      p_bike: 0.45,
      p_dock: 0.8,
      exp_bikes: 2.1,
      q10: 0,
      q90: 5,
      tier: 'bd_raw',
      reason: null,
    },
  ],
  history: [
    { ts: '2026-08-17T11:00:00Z', bikes: 6, docks: 9 },
    { ts: '2026-08-17T11:30:00Z', bikes: 7, docks: 8 },
    { ts: '2026-08-17T12:00:00Z', bikes: 5, docks: 10 },
  ],
  typical: Array.from({ length: 96 }, (_, bucket) => ({
    bucket,
    mean_fill: 0.4 + 0.2 * Math.sin(bucket / 15),
    p_bike: 0.5 + 0.3 * Math.sin(bucket / 15),
    p_dock: 0.5 - 0.3 * Math.sin(bucket / 15),
  })),
  neighbors: [
    { id: 2, name: 'Yonge / Wellesley', distance_m: 1400, bikes: 0, docks: 24 },
    { id: 3, name: 'Bay / College', distance_m: 900, bikes: 2, docks: 18 },
  ],
};

export const stationHistoryResponseFixture: StationHistoryResponse = {
  points: stationDetailResponseFixture.history,
};

export const healthResponseFixture: HealthResponse = {
  ok: true,
  version: '0.1.0',
  db: true,
  collector_last_ok_at: '2026-08-17T12:00:00Z',
  predictor_last_run_at: '2026-08-17T12:00:00Z',
};

export const userResponseFixture: UserResponse = {
  user: {
    id: '9c858f5e-3e1e-4a3c-8f0a-7b6a2b1e2b8a',
    email: 'rider@example.com',
    created_at: '2026-08-01T00:00:00Z',
  },
};
