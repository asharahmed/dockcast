import { describe, expect, it } from 'vitest';
import { schemas } from '../src/index.js';
import * as fixtures from './fixtures.js';

describe('every schema parses its fixture', () => {
  it.each([
    ['legKind', schemas.legKind, fixtures.legKindFixture],
    ['verdict', schemas.verdict, fixtures.verdictFixture],
    ['errorResponse', schemas.errorResponse, fixtures.errorResponseFixture],
    ['healthResponse', schemas.healthResponse, fixtures.healthResponseFixture],
    ['city', schemas.city, fixtures.cityFixture],
    ['cityListResponse', schemas.cityListResponse, fixtures.cityListResponseFixture],
    ['stationRef', schemas.stationRef, fixtures.stationRefFixture],
    ['stationListItem', schemas.stationListItem, fixtures.stationListItemFixture],
    ['stationListResponse', schemas.stationListResponse, fixtures.stationListResponseFixture],
    ['mapStation', schemas.mapStation, fixtures.mapStationFixture],
    ['mapResponse', schemas.mapResponse, fixtures.mapResponseFixture],
    ['stationCurrent', schemas.stationCurrent, fixtures.stationCurrentFixture],
    ['stationForecastRow', schemas.stationForecastRow, fixtures.stationForecastRowFixture],
    ['stationHistoryPoint', schemas.stationHistoryPoint, fixtures.stationHistoryPointFixture],
    ['stationTypicalRow', schemas.stationTypicalRow, fixtures.stationTypicalRowFixture],
    ['stationNeighbor', schemas.stationNeighbor, fixtures.stationNeighborFixture],
    ['stationDetailResponse', schemas.stationDetailResponse, fixtures.stationDetailResponseFixture],
    ['stationHistoryQuery', schemas.stationHistoryQuery, fixtures.stationHistoryQueryFixture],
    [
      'stationHistoryResponse',
      schemas.stationHistoryResponse,
      fixtures.stationHistoryResponseFixture,
    ],
    ['modelMetricRow', schemas.modelMetricRow, fixtures.modelMetricRowFixture],
    [
      'modelMetricRow (reliability bin)',
      schemas.modelMetricRow,
      fixtures.modelMetricRowReliabilityFixture,
    ],
    ['metricsVal', schemas.metricsVal, fixtures.metricsValFixture],
    ['gate', schemas.gate, fixtures.gateFixture],
    ['modelVersionSummary', schemas.modelVersionSummary, fixtures.modelVersionSummaryFixture],
    ['modelResponse', schemas.modelResponse, fixtures.modelResponseFixture],
    ['modelEvalRow', schemas.modelEvalRow, fixtures.modelEvalRowFixture],
    [
      'modelVersionDetailResponse',
      schemas.modelVersionDetailResponse,
      fixtures.modelVersionDetailResponseFixture,
    ],
    ['tripQuery', schemas.tripQuery, fixtures.tripQueryFixture],
    ['tripCurrent', schemas.tripCurrent, fixtures.tripCurrentFixture],
    ['tripAlternative', schemas.tripAlternative, fixtures.tripAlternativeFixture],
    ['tripLeg', schemas.tripLeg, fixtures.tripLegFixture],
    ['tripResponse', schemas.tripResponse, fixtures.tripResponseFixture],
    ['registerRequest', schemas.registerRequest, fixtures.registerRequestFixture],
    ['loginRequest', schemas.loginRequest, fixtures.loginRequestFixture],
    ['userResponse', schemas.userResponse, fixtures.userResponseFixture],
    ['daysOfWeek', schemas.daysOfWeek, fixtures.daysOfWeekFixture],
    ['commute', schemas.commute, fixtures.commuteFixture],
    ['commuteOutlookLeg', schemas.commuteOutlookLeg, fixtures.commuteOutlookLegFixture],
    ['commuteOutlook', schemas.commuteOutlook, fixtures.commuteOutlookFixture],
    ['commuteWithOutlook', schemas.commuteWithOutlook, fixtures.commuteWithOutlookFixture],
    ['commuteListResponse', schemas.commuteListResponse, fixtures.commuteListResponseFixture],
    ['commuteCreateRequest', schemas.commuteCreateRequest, fixtures.commuteCreateRequestFixture],
    ['commuteUpdateRequest', schemas.commuteUpdateRequest, fixtures.commuteUpdateRequestFixture],
    ['commuteCreateResponse', schemas.commuteCreateResponse, fixtures.commuteCreateResponseFixture],
    ['commuteUpdateResponse', schemas.commuteUpdateResponse, fixtures.commuteUpdateResponseFixture],
    ['pushSubscribeRequest', schemas.pushSubscribeRequest, fixtures.pushSubscribeRequestFixture],
    ['pushSubscribeResponse', schemas.pushSubscribeResponse, fixtures.pushSubscribeResponseFixture],
    [
      'pushUnsubscribeRequest',
      schemas.pushUnsubscribeRequest,
      fixtures.pushUnsubscribeRequestFixture,
    ],
    ['vapidKeyResponse', schemas.vapidKeyResponse, fixtures.vapidKeyResponseFixture],
    ['pushTestResponse', schemas.pushTestResponse, fixtures.pushTestResponseFixture],
  ] as const)('%s', (_name, schema, fixture) => {
    expect(schema.parse(fixture)).toBeTruthy();
  });
});

describe('schemas reject invalid variants', () => {
  it('registerRequest: password under 10 chars', () => {
    const result = schemas.registerRequest.safeParse({
      ...fixtures.registerRequestFixture,
      password: 'short1',
    });
    expect(result.success).toBe(false);
  });

  it('registerRequest: malformed email', () => {
    const result = schemas.registerRequest.safeParse({
      ...fixtures.registerRequestFixture,
      email: 'not-an-email',
    });
    expect(result.success).toBe(false);
  });

  it('commuteCreateRequest: bad depart_local_time', () => {
    const result = schemas.commuteCreateRequest.safeParse({
      ...fixtures.commuteCreateRequestFixture,
      depart_local_time: '8:15', // must be zero-padded HH:MM
    });
    expect(result.success).toBe(false);
  });

  it('commuteCreateRequest: depart_local_time with an invalid hour', () => {
    const result = schemas.commuteCreateRequest.safeParse({
      ...fixtures.commuteCreateRequestFixture,
      depart_local_time: '24:00',
    });
    expect(result.success).toBe(false);
  });

  it('commuteCreateRequest: duplicate days_of_week', () => {
    const result = schemas.commuteCreateRequest.safeParse({
      ...fixtures.commuteCreateRequestFixture,
      days_of_week: [0, 1, 1],
    });
    expect(result.success).toBe(false);
  });

  it('commuteCreateRequest: empty days_of_week', () => {
    const result = schemas.commuteCreateRequest.safeParse({
      ...fixtures.commuteCreateRequestFixture,
      days_of_week: [],
    });
    expect(result.success).toBe(false);
  });

  it('commuteCreateRequest: threshold out of [0.05, 0.95]', () => {
    const result = schemas.commuteCreateRequest.safeParse({
      ...fixtures.commuteCreateRequestFixture,
      threshold: 0.96,
    });
    expect(result.success).toBe(false);
  });

  it('commuteCreateRequest: ride_minutes out of [1, 180]', () => {
    const result = schemas.commuteCreateRequest.safeParse({
      ...fixtures.commuteCreateRequestFixture,
      ride_minutes: 181,
    });
    expect(result.success).toBe(false);
  });

  it('commuteCreateRequest: alert_lead_minutes out of [5, 120]', () => {
    const result = schemas.commuteCreateRequest.safeParse({
      ...fixtures.commuteCreateRequestFixture,
      alert_lead_minutes: 3,
    });
    expect(result.success).toBe(false);
  });

  it('pushSubscribeRequest: endpoint not a URL', () => {
    const result = schemas.pushSubscribeRequest.safeParse({
      ...fixtures.pushSubscribeRequestFixture,
      endpoint: 'not-a-url',
    });
    expect(result.success).toBe(false);
  });

  it('stationHistoryQuery: hours out of [1, 168]', () => {
    expect(schemas.stationHistoryQuery.safeParse({ hours: 169 }).success).toBe(false);
    expect(schemas.stationHistoryQuery.safeParse({ hours: 0 }).success).toBe(false);
  });

  it('modelMetricRow: horizon not 0 or a member of HORIZONS', () => {
    const result = schemas.modelMetricRow.safeParse({
      ...fixtures.modelMetricRowFixture,
      horizon: 20,
    });
    expect(result.success).toBe(false);
  });

  it('modelMetricRow: unknown metric name', () => {
    const result = schemas.modelMetricRow.safeParse({
      ...fixtures.modelMetricRowFixture,
      metric: 'not_a_real_metric',
    });
    expect(result.success).toBe(false);
  });

  it('healthResponse: wrong type for ok', () => {
    const result = schemas.healthResponse.safeParse({
      ...fixtures.healthResponseFixture,
      ok: 'yes',
    });
    expect(result.success).toBe(false);
  });

  it('errorResponse: missing required message', () => {
    const result = schemas.errorResponse.safeParse({ error: { code: 'internal_error' } });
    expect(result.success).toBe(false);
  });
});
