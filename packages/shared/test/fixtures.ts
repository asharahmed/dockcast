/**
 * Hand-written fixture objects, one per schema exported from `src/index.ts`.
 * Used by `test/schemas.test.ts` to assert every schema parses a valid
 * payload (and, for a subset, rejects an invalid variant).
 */
import type {
  City,
  CityListResponse,
  StationRef,
  StationListItem,
  StationListResponse,
  MapStation,
  MapResponse,
  StationCurrent,
  StationForecastRow,
  StationHistoryPoint,
  StationTypicalRow,
  StationNeighbor,
  StationDetailResponse,
  StationHistoryQuery,
  StationHistoryResponse,
  ModelMetricRow,
  MetricsVal,
  Gate,
  ModelVersionSummary,
  ModelResponse,
  ModelEvalRow,
  ModelVersionDetailResponse,
  TripQuery,
  TripCurrent,
  TripAlternative,
  TripLeg,
  TripResponse,
  RegisterRequest,
  LoginRequest,
  UserResponse,
  DaysOfWeek,
  Commute,
  CommuteOutlookLeg,
  CommuteOutlook,
  CommuteWithOutlook,
  CommuteListResponse,
  CommuteCreateRequest,
  CommuteUpdateRequest,
  CommuteCreateResponse,
  CommuteUpdateResponse,
  PushSubscribeRequest,
  PushSubscribeResponse,
  PushUnsubscribeRequest,
  VapidKeyResponse,
  PushTestResponse,
  ErrorResponse,
  HealthResponse,
  LegKind,
  Verdict,
} from '../src/index.js';

export const legKindFixture: LegKind = 'forecast';
export const verdictFixture: Verdict = 'good';

export const errorResponseFixture: ErrorResponse = {
  error: { code: 'validation_error', message: 'Invalid request', details: { field: 'email' } },
};

export const healthResponseFixture: HealthResponse = {
  ok: true,
  version: '1.0.0',
  db: true,
  collector_last_ok_at: '2026-08-17T12:00:00Z',
  predictor_last_run_at: '2026-08-17T12:05:00Z',
};

export const cityFixture: City = {
  slug: 'toronto',
  name: 'Bike Share Toronto',
  tz: 'America/Toronto',
  lat: 43.6532,
  lon: -79.3832,
  forecasting_enabled: true,
  station_count: 1058,
  last_status_ok_at: '2026-08-17T12:00:00Z',
};

export const cityListResponseFixture: CityListResponse = { cities: [cityFixture] };

export const stationRefFixture: StationRef = {
  id: 42,
  name: 'Union Station',
  lat: 43.6453,
  lon: -79.3806,
};

export const stationListItemFixture: StationListItem = {
  id: 42,
  station_id: '7000',
  name: 'Union Station',
  lat: 43.6453,
  lon: -79.3806,
  capacity: 30,
};

export const stationListResponseFixture: StationListResponse = {
  stations: [stationListItemFixture],
};

export const mapStationFixture: MapStation = {
  id: 42,
  b: 5,
  d: 10,
  c: 15,
  fresh: true,
  f: [null, [0.8, 0.6, 4.2], [0.75, 0.65, 4.0], [0.7, 0.7, 3.8], null, [0.6, 0.8, 3.0]],
};

export const mapResponseFixture: MapResponse = {
  t0: '2026-08-17T12:00:00Z',
  as_of: '2026-08-17T12:00:30Z',
  horizons: [15, 30, 45, 60, 90, 120],
  stations: [mapStationFixture],
};

export const stationCurrentFixture: StationCurrent = {
  bikes: 5,
  docks: 10,
  ebikes: 2,
  cap_eff: 15,
  is_fresh: true,
  as_of: '2026-08-17T12:00:00Z',
  last_reported: '2026-08-17T11:59:30Z',
};

export const stationForecastRowFixture: StationForecastRow = {
  horizon: 15,
  valid_at: '2026-08-17T12:15:00Z',
  p_bike: 0.82,
  p_dock: 0.41,
  exp_bikes: 4.1,
  q10: 2,
  q90: 7,
  tier: 'bd_raw',
  reason: null,
};

export const stationHistoryPointFixture: StationHistoryPoint = {
  ts: '2026-08-17T11:55:00Z',
  bikes: 6,
  docks: 9,
};

export const stationTypicalRowFixture: StationTypicalRow = {
  bucket: 32,
  mean_fill: 0.4,
  p_bike: 0.7,
  p_dock: 0.55,
};

export const stationNeighborFixture: StationNeighbor = {
  id: 43,
  name: 'Yonge / Wellesley',
  distance_m: 350,
  bikes: 3,
  docks: 12,
};

export const stationDetailResponseFixture: StationDetailResponse = {
  station: {
    id: 42,
    station_id: '7000',
    name: 'Union Station',
    lat: 43.6453,
    lon: -79.3806,
    capacity: 30,
    city: { slug: 'toronto', name: 'Bike Share Toronto', tz: 'America/Toronto' },
  },
  current: stationCurrentFixture,
  forecasts: [stationForecastRowFixture],
  history: [stationHistoryPointFixture],
  typical: [stationTypicalRowFixture],
  neighbors: [stationNeighborFixture],
};

export const stationHistoryQueryFixture: StationHistoryQuery = { hours: 24 };

export const stationHistoryResponseFixture: StationHistoryResponse = {
  points: [stationHistoryPointFixture],
};

export const modelMetricRowFixture: ModelMetricRow = {
  day: '2026-08-16',
  window_days: 7,
  tier: 'gbm_active',
  target: 'bike',
  horizon: 15,
  slice: 'all',
  metric: 'brier',
  value: 0.062,
  n: 12340,
};

export const modelMetricRowReliabilityFixture: ModelMetricRow = {
  day: '2026-08-16',
  window_days: 7,
  tier: 'bd_cal',
  target: 'dock',
  horizon: 0,
  slice: 'all',
  metric: 'rel_bin_3_mean_pred',
  value: 0.72,
  n: 3210,
};

export const metricsValFixture: MetricsVal = {
  n_val: 200000,
  brier: { bike: 0.06, dock: 0.07 },
  logloss: { bike: 0.2, dock: 0.22 },
  auc: { bike: 0.9, dock: null },
  ece: { bike: 0.02, dock: 0.03 },
  mae: 1.2,
  rmse: 1.8,
  brier_at_risk: { bike: 0.09, dock: 0.1 },
  ref: { tier: 'bd_cal', brier: { bike: 0.08, dock: 0.09 }, mae: 1.5 },
};

export const gateFixture: Gate = {
  passed: true,
  checks: [
    { name: 'brier_bike_vs_ref', value: 0.06, threshold: 0.076, ok: true },
    { name: 'brier_dock_vs_ref', value: 0.07, threshold: 0.0855, ok: true },
    { name: 'ece_bike', value: 0.02, threshold: 0.05, ok: true },
    { name: 'ece_dock', value: 0.03, threshold: 0.05, ok: true },
    { name: 'mae_vs_ref', value: 1.2, threshold: 1.5, ok: true },
  ],
};

export const modelVersionSummaryFixture: ModelVersionSummary = {
  id: 7,
  tier: 'gbm',
  status: 'active',
  trained_for_date: '2026-08-16',
  created_at: '2026-08-17T03:35:00Z',
  activated_at: '2026-08-17T03:36:00Z',
  feature_schema_version: 1,
  train_window: ['2026-06-18T00:00:00-04:00', '2026-08-16T00:00:00-04:00'],
  metrics_val: metricsValFixture,
  gate: gateFixture,
};

export const modelResponseFixture: ModelResponse = {
  city: { slug: 'toronto', name: 'Bike Share Toronto', tz: 'America/Toronto' },
  data_since: '2025-04-01T04:00:00Z',
  n_stations_active: 1058,
  collector: { last_ok_at: '2026-08-17T12:00:00Z', uptime_7d_pct: 99.8 },
  predictor: { last_run_at: '2026-08-17T12:05:00Z', serving_tier: 'gbm' },
  active: { gbm: modelVersionSummaryFixture, bd: modelVersionSummaryFixture },
  metrics: [modelMetricRowFixture, modelMetricRowReliabilityFixture],
  versions: [modelVersionSummaryFixture],
};

export const modelEvalRowFixture: ModelEvalRow = {
  split: 'val',
  target: 'bike',
  horizon: 60,
  slice: 'at_risk',
  metric: 'logloss',
  value: 0.21,
};

export const modelVersionDetailResponseFixture: ModelVersionDetailResponse = {
  version: modelVersionSummaryFixture,
  eval: [modelEvalRowFixture],
};

export const tripQueryFixture: TripQuery = {
  origin: 42,
  dest: 43,
  depart_at: '2026-08-17T12:15:00Z',
  ride_minutes: 14,
};

export const tripCurrentFixture: TripCurrent = {
  bikes: 5,
  docks: 10,
  cap_eff: 15,
  as_of: '2026-08-17T12:00:00Z',
  is_fresh: true,
};

export const tripAlternativeFixture: TripAlternative = {
  station: stationRefFixture,
  distance_m: 240,
  walk_minutes: 3,
  p: 0.93,
  exp_bikes: 6.1,
};

export const tripLegFixture: TripLeg = {
  station: stationRefFixture,
  lead_minutes: 15,
  kind: 'forecast',
  reason: null,
  tier: 'bd_raw',
  p: 0.82,
  exp_bikes: 4.1,
  current: tripCurrentFixture,
  alternatives: [tripAlternativeFixture],
};

export const tripResponseFixture: TripResponse = {
  computed_at: '2026-08-17T12:00:00Z',
  forecast_t0: '2026-08-17T12:00:00Z',
  depart_at: '2026-08-17T12:15:00Z',
  arrive_at: '2026-08-17T12:29:00Z',
  ride_minutes: 14,
  origin: tripLegFixture,
  dest: { ...tripLegFixture, p: 0.41 },
  verdict: 'risky',
};

export const registerRequestFixture: RegisterRequest = {
  email: 'rider@example.com',
  password: 'correct-horse-battery',
};

export const loginRequestFixture: LoginRequest = {
  email: 'rider@example.com',
  password: 'correct-horse-battery',
};

export const userResponseFixture: UserResponse = {
  user: {
    id: '9c858f5e-3e1e-4a3c-8f0a-7b6a2b1e2b8a',
    email: 'rider@example.com',
    created_at: '2026-08-01T00:00:00Z',
  },
};

export const daysOfWeekFixture: DaysOfWeek = [0, 1, 2, 3, 4];

export const commuteFixture: Commute = {
  id: '3fae7c9c-1b2d-4c2a-9b0e-1a2b3c4d5e6f',
  name: 'Commute to work',
  city: { slug: 'toronto', tz: 'America/Toronto' },
  origin: stationRefFixture,
  dest: { id: 43, name: 'Yonge / Wellesley', lat: 43.6659, lon: -79.3835 },
  depart_local_time: '08:15',
  ride_minutes: 14,
  days_of_week: daysOfWeekFixture,
  alert_enabled: true,
  alert_lead_minutes: 20,
  threshold: 0.7,
  created_at: '2026-08-01T00:00:00Z',
  updated_at: '2026-08-01T00:00:00Z',
};

export const commuteOutlookLegFixture: CommuteOutlookLeg = { kind: 'forecast', p: 0.82 };

export const commuteOutlookFixture: CommuteOutlook = {
  next_depart_at: '2026-08-18T08:15:00-04:00',
  next_arrive_at: '2026-08-18T08:29:00-04:00',
  origin: commuteOutlookLegFixture,
  dest: { kind: 'forecast', p: 0.41 },
  verdict: 'risky',
};

export const commuteWithOutlookFixture: CommuteWithOutlook = {
  ...commuteFixture,
  outlook: commuteOutlookFixture,
};

export const commuteListResponseFixture: CommuteListResponse = {
  commutes: [commuteWithOutlookFixture],
};

export const commuteCreateRequestFixture: CommuteCreateRequest = {
  name: 'Commute to work',
  origin_station_id: 42,
  dest_station_id: 43,
  depart_local_time: '08:15',
  ride_minutes: 14,
  days_of_week: [0, 1, 2, 3, 4],
  alert_enabled: true,
  alert_lead_minutes: 20,
  threshold: 0.7,
};

export const commuteUpdateRequestFixture: CommuteUpdateRequest = {
  name: 'Commute home',
  threshold: 0.6,
};

export const commuteCreateResponseFixture: CommuteCreateResponse = { commute: commuteFixture };
export const commuteUpdateResponseFixture: CommuteUpdateResponse = { commute: commuteFixture };

export const pushSubscribeRequestFixture: PushSubscribeRequest = {
  endpoint: 'https://push.example.com/abc123',
  keys: { p256dh: 'p256dh-key', auth: 'auth-secret' },
  user_agent: 'Mozilla/5.0',
};

export const pushSubscribeResponseFixture: PushSubscribeResponse = {
  id: '9c858f5e-3e1e-4a3c-8f0a-7b6a2b1e2b8b',
};

export const pushUnsubscribeRequestFixture: PushUnsubscribeRequest = {
  endpoint: 'https://push.example.com/abc123',
};

export const vapidKeyResponseFixture: VapidKeyResponse = { publicKey: 'BFakeVapidPublicKey' };

export const pushTestResponseFixture: PushTestResponse = { sent: 2 };
