/**
 * MSW fixture DTOs, conforming to `@dockcast/shared`'s zod schemas
 * (validated by `test/mocks.test.ts`). ui-spec.md §1: "build against MSW
 * handlers... that serve fixture DTOs conforming to the shared zod schemas."
 */
import { HORIZONS } from '@dockcast/shared';
import type {
  CityListResponse,
  StationListResponse,
  MapResponse,
  StationDetailResponse,
  StationHistoryResponse,
  HealthResponse,
  UserResponse,
  TripResponse,
  ModelResponse,
  ModelVersionSummary,
  ModelVersionDetailResponse,
  ModelMetricRow,
  ModelTier,
  ModelVersionStatus,
  MetricsTier,
  MetricsTarget,
  MetricName,
  CommuteWithOutlook,
  CommuteListResponse,
  VapidKeyResponse,
  PushSubscribeResponse,
  PushTestResponse,
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

export const stationList = [
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

// --- /trip (WP-10) --------------------------------------------------------

/** Both legs `kind: 'forecast'` with high `p` -> `verdict: 'good'`. */
export const tripResponseGoodFixture: TripResponse = {
  computed_at: '2026-08-17T12:00:00Z',
  forecast_t0: '2026-08-17T12:00:00Z',
  depart_at: '2026-08-17T12:15:00Z',
  arrive_at: '2026-08-17T12:30:00Z',
  ride_minutes: 15,
  origin: {
    station: { id: 1, name: 'Union Station', lat: 43.6453, lon: -79.3806 },
    lead_minutes: 15,
    kind: 'forecast',
    reason: null,
    tier: 'bd_raw',
    p: 0.9,
    exp_bikes: 5,
    current: { bikes: 5, docks: 10, cap_eff: 15, as_of: '2026-08-17T12:00:00Z', is_fresh: true },
    alternatives: [],
  },
  dest: {
    station: { id: 2, name: 'Yonge / Wellesley', lat: 43.6659, lon: -79.3835 },
    lead_minutes: 30,
    kind: 'forecast',
    reason: null,
    tier: 'bd_raw',
    p: 0.92,
    exp_bikes: 3,
    current: { bikes: 2, docks: 20, cap_eff: 22, as_of: '2026-08-17T12:00:00Z', is_fresh: true },
    alternatives: [],
  },
  verdict: 'good',
};

/**
 * `verdict: 'bad'` (origin has a low `p`) with the dest leg `kind:
 * 'unavailable'`/`reason: 'not_fresh'` and one `p >= ALT_GOOD_P` alternative
 * — exercises the "Don't count on it" verdict copy, the unavailable-leg
 * reason text, and the "Safe bet" alternative badge in one fixture
 * (ui-spec.md §11 `TripResult.test.tsx` row).
 */
export const tripResponseBadFixture: TripResponse = {
  computed_at: '2026-08-17T12:00:00Z',
  forecast_t0: '2026-08-17T12:00:00Z',
  depart_at: '2026-08-17T12:15:00Z',
  arrive_at: '2026-08-17T12:30:00Z',
  ride_minutes: 15,
  origin: {
    station: { id: 1, name: 'Union Station', lat: 43.6453, lon: -79.3806 },
    lead_minutes: 15,
    kind: 'forecast',
    reason: null,
    tier: 'bd_raw',
    p: 0.3,
    exp_bikes: 1,
    current: { bikes: 1, docks: 14, cap_eff: 15, as_of: '2026-08-17T12:00:00Z', is_fresh: true },
    alternatives: [],
  },
  dest: {
    station: { id: 3, name: 'Bay / College', lat: 43.6598, lon: -79.3894 },
    lead_minutes: 30,
    kind: 'unavailable',
    reason: 'not_fresh',
    tier: null,
    p: null,
    exp_bikes: null,
    current: null,
    alternatives: [
      {
        station: { id: 2, name: 'Yonge / Wellesley', lat: 43.6659, lon: -79.3835 },
        distance_m: 250,
        walk_minutes: 4,
        p: 0.93,
        exp_bikes: 8,
      },
    ],
  },
  verdict: 'bad',
};

/** Both legs `kind: 'typical'` (beyond `MAX_LEAD`) -> `verdict: 'unknown'`. */
export const tripResponseTypicalFixture: TripResponse = {
  computed_at: '2026-08-17T12:00:00Z',
  forecast_t0: null,
  depart_at: '2026-08-17T15:00:00Z',
  arrive_at: '2026-08-17T15:15:00Z',
  ride_minutes: 15,
  origin: {
    station: { id: 1, name: 'Union Station', lat: 43.6453, lon: -79.3806 },
    lead_minutes: 180,
    kind: 'typical',
    reason: null,
    tier: null,
    p: 0.6,
    exp_bikes: null,
    current: { bikes: 4, docks: 11, cap_eff: 15, as_of: '2026-08-17T12:00:00Z', is_fresh: true },
    alternatives: [],
  },
  dest: {
    station: { id: 2, name: 'Yonge / Wellesley', lat: 43.6659, lon: -79.3835 },
    lead_minutes: 195,
    kind: 'typical',
    reason: null,
    tier: null,
    p: 0.55,
    exp_bikes: null,
    current: null,
    alternatives: [],
  },
  verdict: 'unknown',
};

export const tripResponseFixture = tripResponseGoodFixture;

// --- /model (WP-10) --------------------------------------------------------

function buildModelMetrics(): ModelMetricRow[] {
  const day = '2026-08-16';
  const tiers: { tier: MetricsTier; base: number }[] = [
    { tier: 'gbm_active', base: 0.06 },
    { tier: 'bd_cal', base: 0.08 },
    { tier: 'persistence', base: 0.1 },
  ];
  const targets: MetricsTarget[] = ['bike', 'dock'];
  const rows: ModelMetricRow[] = [];

  for (const target of targets) {
    for (const { tier, base } of tiers) {
      for (const horizon of HORIZONS) {
        rows.push({
          day,
          window_days: 7,
          tier,
          target,
          horizon,
          slice: 'all',
          metric: 'brier',
          value: Number((base + horizon * 0.0003).toFixed(4)),
          n: 12_000 - horizon * 10,
        });
      }
      rows.push({
        day,
        window_days: 7,
        tier,
        target,
        horizon: 0,
        slice: 'all',
        metric: 'ece',
        value: Number((base * 0.3).toFixed(4)),
        n: 12_000,
      });
    }

    for (let bin = 0; bin <= 9; bin++) {
      const meanPred = (bin + 0.5) / 10;
      const fracPos = Math.min(1, Math.max(0, meanPred + (bin % 2 === 0 ? 0.02 : -0.02)));
      rows.push({
        day,
        window_days: 7,
        tier: 'gbm_active',
        target,
        horizon: 0,
        slice: 'all',
        metric: `rel_bin_${bin}_mean_pred` as MetricName,
        value: meanPred,
        n: 300,
      });
      rows.push({
        day,
        window_days: 7,
        tier: 'gbm_active',
        target,
        horizon: 0,
        slice: 'all',
        metric: `rel_bin_${bin}_frac_pos` as MetricName,
        value: Number(fracPos.toFixed(3)),
        n: 300,
      });
      rows.push({
        day,
        window_days: 7,
        tier: 'gbm_active',
        target,
        horizon: 0,
        slice: 'all',
        metric: `rel_bin_${bin}_n` as MetricName,
        value: 300,
        n: 300,
      });
    }
  }

  for (const { tier, base } of tiers) {
    for (const horizon of HORIZONS) {
      rows.push({
        day,
        window_days: 7,
        tier,
        target: 'cnt',
        horizon,
        slice: 'all',
        metric: 'mae',
        value: Number((base * 15).toFixed(3)),
        n: 12_000,
      });
    }
  }

  return rows;
}

function modelVersionSummaryFixture(
  id: number,
  tier: ModelTier,
  status: ModelVersionStatus,
  gatePassed = true,
): ModelVersionSummary {
  return {
    id,
    tier,
    status,
    trained_for_date: '2026-08-16',
    created_at: `2026-08-${String(16 - id).padStart(2, '0')}T04:00:00Z`,
    activated_at: status === 'active' ? '2026-08-16T04:05:00Z' : null,
    feature_schema_version: 1,
    train_window: ['2025-08-01T00:00:00Z', '2026-08-15T00:00:00Z'],
    metrics_val:
      tier === 'gbm'
        ? {
            n_val: 5000,
            brier: { bike: 0.07, dock: 0.09 },
            logloss: { bike: 0.25, dock: 0.3 },
            auc: { bike: 0.81, dock: 0.78 },
            ece: { bike: 0.02, dock: 0.03 },
            mae: 0.9,
            rmse: 1.3,
            brier_at_risk: { bike: 0.1, dock: 0.12 },
            ref: { tier: 'bd_cal', brier: { bike: 0.08, dock: 0.1 }, mae: 1.0 },
          }
        : null,
    gate:
      tier === 'gbm'
        ? {
            passed: gatePassed,
            checks: [
              { name: 'brier_bike_vs_ref', value: 0.07, threshold: 0.08, ok: gatePassed },
              { name: 'brier_dock_vs_ref', value: 0.09, threshold: 0.1, ok: true },
              { name: 'ece_bike', value: 0.02, threshold: 0.05, ok: true },
            ],
          }
        : null,
  };
}

export const modelVersionActiveGbmFixture = modelVersionSummaryFixture(1, 'gbm', 'active');
export const modelVersionActiveBdFixture = modelVersionSummaryFixture(2, 'bd', 'active');
export const modelVersionShadowFixture = modelVersionSummaryFixture(3, 'gbm', 'shadow', false);

export const modelResponseFixture: ModelResponse = {
  city: { slug: cityFixture.slug, name: cityFixture.name, tz: cityFixture.tz },
  data_since: '2025-01-01T00:00:00Z',
  n_stations_active: 3,
  collector: { last_ok_at: '2026-08-17T12:00:00Z', uptime_7d_pct: 99.2 },
  predictor: { last_run_at: '2026-08-17T12:00:00Z', serving_tier: 'gbm' },
  active: { gbm: modelVersionActiveGbmFixture, bd: modelVersionActiveBdFixture },
  metrics: buildModelMetrics(),
  versions: [modelVersionShadowFixture, modelVersionActiveBdFixture, modelVersionActiveGbmFixture],
};

export const modelVersionDetailResponseFixture: ModelVersionDetailResponse = {
  version: modelVersionActiveGbmFixture,
  eval: [
    { tier: 'gbm', split: 'val', target: 'bike', horizon: 0, slice: 'all', metric: 'brier', value: 0.07 },
    { tier: 'gbm', split: 'val', target: 'dock', horizon: 0, slice: 'all', metric: 'brier', value: 0.09 },
  ],
};

// --- /commutes (WP-10) ------------------------------------------------------

export const commuteFixture: CommuteWithOutlook = {
  id: '11111111-1111-1111-1111-111111111111',
  name: 'Commute to work',
  city: { slug: 'toronto', tz: 'America/Toronto' },
  origin: { id: 1, name: 'Union Station', lat: 43.6453, lon: -79.3806 },
  dest: { id: 2, name: 'Yonge / Wellesley', lat: 43.6659, lon: -79.3835 },
  depart_local_time: '08:15',
  ride_minutes: 15,
  days_of_week: [0, 1, 2, 3, 4],
  alert_enabled: true,
  alert_lead_minutes: 20,
  threshold: 0.7,
  created_at: '2026-08-01T00:00:00Z',
  updated_at: '2026-08-01T00:00:00Z',
  outlook: {
    next_depart_at: '2026-08-18T12:15:00Z',
    next_arrive_at: '2026-08-18T12:30:00Z',
    origin: { kind: 'forecast', p: 0.82 },
    dest: { kind: 'forecast', p: 0.41 },
    verdict: 'risky',
  },
};

export const commuteListResponseFixture: CommuteListResponse = { commutes: [commuteFixture] };

// --- /push (WP-10) ----------------------------------------------------------

export const vapidKeyResponseFixture: VapidKeyResponse = {
  publicKey: 'BExampleVapidPublicKeyBase64UrlEncodedStringForTestingPurposesOnly1234567890',
};

export const pushSubscribeResponseFixture: PushSubscribeResponse = {
  id: '22222222-2222-2222-2222-222222222222',
};

export const pushTestResponseFixture: PushTestResponse = { sent: 1 };
