/**
 * @dockcast/shared — zod schemas + TS types for every API DTO (`docs/api.md`),
 * plus geo/time/forecast helpers shared between `apps/api` and `apps/web`.
 * See `docs/architecture.md` §3.
 */
export * from './constants.js';
export * from './geo.js';
export * from './forecast.js';
export * from './time.js';

export * from './api/errors.js';
export * from './api/system.js';
export * from './api/cities.js';
export * from './api/stations.js';
export * from './api/model.js';
export * from './api/trip.js';
export * from './api/auth.js';
export * from './api/commutes.js';
export * from './api/push.js';

import { legKindSchema, verdictSchema } from './forecast.js';
import { errorResponseSchema } from './api/errors.js';
import { healthResponseSchema } from './api/system.js';
import { citySchema, cityListResponseSchema } from './api/cities.js';
import {
  stationRefSchema,
  stationListItemSchema,
  stationListResponseSchema,
  mapStationSchema,
  mapResponseSchema,
  stationDetailStationSchema,
  stationCurrentSchema,
  stationForecastRowSchema,
  stationHistoryPointSchema,
  stationTypicalRowSchema,
  stationNeighborSchema,
  stationDetailResponseSchema,
  stationHistoryQuerySchema,
  stationHistoryResponseSchema,
} from './api/stations.js';
import {
  servingTierSchema,
  modelTierSchema,
  modelVersionStatusSchema,
  metricsTierSchema,
  metricsTargetSchema,
  metricsSliceSchema,
  metricNameSchema,
  horizonOrPooledSchema,
  modelMetricRowSchema,
  metricsValSchema,
  gateCheckSchema,
  gateSchema,
  modelVersionSummarySchema,
  modelResponseSchema,
  modelEvalRowSchema,
  modelVersionDetailResponseSchema,
} from './api/model.js';
import {
  tripQuerySchema,
  tripCurrentSchema,
  tripAlternativeSchema,
  tripLegSchema,
  tripResponseSchema,
} from './api/trip.js';
import {
  registerRequestSchema,
  loginRequestSchema,
  userResponseSchema,
  authProvidersResponseSchema,
} from './api/auth.js';
import {
  daysOfWeekSchema,
  commuteSchema,
  commuteOutlookLegSchema,
  commuteOutlookSchema,
  commuteWithOutlookSchema,
  commuteListResponseSchema,
  commuteCreateRequestSchema,
  commuteUpdateRequestSchema,
  commuteCreateResponseSchema,
  commuteUpdateResponseSchema,
} from './api/commutes.js';
import {
  pushSubscribeRequestSchema,
  pushSubscribeResponseSchema,
  pushUnsubscribeRequestSchema,
  vapidKeyResponseSchema,
  pushTestResponseSchema,
} from './api/push.js';

/** Every zod schema exported by this package, keyed by a short name. */
export const schemas = {
  legKind: legKindSchema,
  verdict: verdictSchema,

  errorResponse: errorResponseSchema,
  healthResponse: healthResponseSchema,

  city: citySchema,
  cityListResponse: cityListResponseSchema,

  stationRef: stationRefSchema,
  stationListItem: stationListItemSchema,
  stationListResponse: stationListResponseSchema,
  mapStation: mapStationSchema,
  mapResponse: mapResponseSchema,
  stationDetailStation: stationDetailStationSchema,
  stationCurrent: stationCurrentSchema,
  stationForecastRow: stationForecastRowSchema,
  stationHistoryPoint: stationHistoryPointSchema,
  stationTypicalRow: stationTypicalRowSchema,
  stationNeighbor: stationNeighborSchema,
  stationDetailResponse: stationDetailResponseSchema,
  stationHistoryQuery: stationHistoryQuerySchema,
  stationHistoryResponse: stationHistoryResponseSchema,

  servingTier: servingTierSchema,
  modelTier: modelTierSchema,
  modelVersionStatus: modelVersionStatusSchema,
  metricsTier: metricsTierSchema,
  metricsTarget: metricsTargetSchema,
  metricsSlice: metricsSliceSchema,
  metricName: metricNameSchema,
  horizonOrPooled: horizonOrPooledSchema,
  modelMetricRow: modelMetricRowSchema,
  metricsVal: metricsValSchema,
  gateCheck: gateCheckSchema,
  gate: gateSchema,
  modelVersionSummary: modelVersionSummarySchema,
  modelResponse: modelResponseSchema,
  modelEvalRow: modelEvalRowSchema,
  modelVersionDetailResponse: modelVersionDetailResponseSchema,

  tripQuery: tripQuerySchema,
  tripCurrent: tripCurrentSchema,
  tripAlternative: tripAlternativeSchema,
  tripLeg: tripLegSchema,
  tripResponse: tripResponseSchema,

  registerRequest: registerRequestSchema,
  loginRequest: loginRequestSchema,
  userResponse: userResponseSchema,
  authProvidersResponse: authProvidersResponseSchema,

  daysOfWeek: daysOfWeekSchema,
  commute: commuteSchema,
  commuteOutlookLeg: commuteOutlookLegSchema,
  commuteOutlook: commuteOutlookSchema,
  commuteWithOutlook: commuteWithOutlookSchema,
  commuteListResponse: commuteListResponseSchema,
  commuteCreateRequest: commuteCreateRequestSchema,
  commuteUpdateRequest: commuteUpdateRequestSchema,
  commuteCreateResponse: commuteCreateResponseSchema,
  commuteUpdateResponse: commuteUpdateResponseSchema,

  pushSubscribeRequest: pushSubscribeRequestSchema,
  pushSubscribeResponse: pushSubscribeResponseSchema,
  pushUnsubscribeRequest: pushUnsubscribeRequestSchema,
  vapidKeyResponse: vapidKeyResponseSchema,
  pushTestResponse: pushTestResponseSchema,
} as const;
