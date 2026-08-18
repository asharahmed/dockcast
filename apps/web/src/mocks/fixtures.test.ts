/**
 * Validates every MSW fixture against its `@dockcast/shared` zod schema.
 * ui-spec.md: WP-9's MSW handlers "serve fixture DTOs conforming to the
 * shared zod schemas (validate the fixtures with the schemas in a test)".
 */
import { describe, expect, it } from 'vitest';
import { schemas } from '../api/types.js';
import {
  cityListResponseFixture,
  stationListResponseFixture,
  mapResponseFixture,
  stationDetailResponseFixture,
  stationHistoryResponseFixture,
  healthResponseFixture,
  userResponseFixture,
  tripResponseGoodFixture,
  tripResponseBadFixture,
  tripResponseTypicalFixture,
  modelResponseFixture,
  modelVersionDetailResponseFixture,
  commuteListResponseFixture,
  vapidKeyResponseFixture,
  pushSubscribeResponseFixture,
  pushTestResponseFixture,
} from './fixtures.js';

describe('MSW fixtures conform to @dockcast/shared schemas', () => {
  it('cityListResponseFixture', () => {
    expect(schemas.cityListResponse.parse(cityListResponseFixture)).toEqual(
      cityListResponseFixture,
    );
  });

  it('stationListResponseFixture', () => {
    expect(schemas.stationListResponse.parse(stationListResponseFixture)).toEqual(
      stationListResponseFixture,
    );
  });

  it('mapResponseFixture', () => {
    expect(schemas.mapResponse.parse(mapResponseFixture)).toEqual(mapResponseFixture);
  });

  it('stationDetailResponseFixture', () => {
    expect(schemas.stationDetailResponse.parse(stationDetailResponseFixture)).toEqual(
      stationDetailResponseFixture,
    );
  });

  it('stationHistoryResponseFixture', () => {
    expect(schemas.stationHistoryResponse.parse(stationHistoryResponseFixture)).toEqual(
      stationHistoryResponseFixture,
    );
  });

  it('healthResponseFixture', () => {
    expect(schemas.healthResponse.parse(healthResponseFixture)).toEqual(healthResponseFixture);
  });

  it('userResponseFixture', () => {
    expect(schemas.userResponse.parse(userResponseFixture)).toEqual(userResponseFixture);
  });

  it('tripResponseGoodFixture', () => {
    expect(schemas.tripResponse.parse(tripResponseGoodFixture)).toEqual(tripResponseGoodFixture);
  });

  it('tripResponseBadFixture', () => {
    expect(schemas.tripResponse.parse(tripResponseBadFixture)).toEqual(tripResponseBadFixture);
  });

  it('tripResponseTypicalFixture', () => {
    expect(schemas.tripResponse.parse(tripResponseTypicalFixture)).toEqual(
      tripResponseTypicalFixture,
    );
  });

  it('modelResponseFixture', () => {
    expect(schemas.modelResponse.parse(modelResponseFixture)).toEqual(modelResponseFixture);
  });

  it('modelVersionDetailResponseFixture', () => {
    expect(schemas.modelVersionDetailResponse.parse(modelVersionDetailResponseFixture)).toEqual(
      modelVersionDetailResponseFixture,
    );
  });

  it('commuteListResponseFixture', () => {
    expect(schemas.commuteListResponse.parse(commuteListResponseFixture)).toEqual(
      commuteListResponseFixture,
    );
  });

  it('vapidKeyResponseFixture', () => {
    expect(schemas.vapidKeyResponse.parse(vapidKeyResponseFixture)).toEqual(
      vapidKeyResponseFixture,
    );
  });

  it('pushSubscribeResponseFixture', () => {
    expect(schemas.pushSubscribeResponse.parse(pushSubscribeResponseFixture)).toEqual(
      pushSubscribeResponseFixture,
    );
  });

  it('pushTestResponseFixture', () => {
    expect(schemas.pushTestResponse.parse(pushTestResponseFixture)).toEqual(
      pushTestResponseFixture,
    );
  });
});
