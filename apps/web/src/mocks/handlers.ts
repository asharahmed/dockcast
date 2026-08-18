/**
 * MSW request handlers for `/api/v1/*`, enabled in dev (`VITE_USE_MOCKS=1`)
 * and in tests. ui-spec.md §1 (WP-9: "build against MSW... handlers under
 * `apps/web/src/mocks/`").
 */
import { http, HttpResponse } from 'msw';
import {
  cityListResponseFixture,
  stationListResponseFixture,
  stationList,
  mapResponseFixture,
  stationDetailResponseFixture,
  stationHistoryResponseFixture,
  healthResponseFixture,
  userResponseFixture,
  tripResponseGoodFixture,
  modelResponseFixture,
  modelVersionDetailResponseFixture,
  commuteFixture,
  commuteListResponseFixture,
  vapidKeyResponseFixture,
  pushSubscribeResponseFixture,
  pushTestResponseFixture,
} from './fixtures.js';
import type { Commute, CommuteCreateRequest, CommuteUpdateRequest } from '../api/types.js';

let signedIn = false;

export const handlers = [
  http.get('/api/v1/health', () => HttpResponse.json(healthResponseFixture)),

  http.get('/api/v1/cities', () => HttpResponse.json(cityListResponseFixture)),

  http.get('/api/v1/cities/:slug/stations', () => HttpResponse.json(stationListResponseFixture)),

  http.get('/api/v1/cities/:slug/map', () => HttpResponse.json(mapResponseFixture)),

  http.get('/api/v1/stations/:id', ({ params }) => {
    if (Number(params.id) !== stationDetailResponseFixture.station.id) {
      return HttpResponse.json(
        { error: { code: 'not_found', message: 'Unknown station' } },
        { status: 404 },
      );
    }
    return HttpResponse.json(stationDetailResponseFixture);
  }),

  http.get('/api/v1/stations/:id/history', () => HttpResponse.json(stationHistoryResponseFixture)),

  http.get('/api/v1/auth/me', () => {
    if (!signedIn) {
      return HttpResponse.json(
        { error: { code: 'unauthorized', message: 'Not signed in' } },
        { status: 401 },
      );
    }
    return HttpResponse.json(userResponseFixture);
  }),

  http.post('/api/v1/auth/login', () => {
    signedIn = true;
    return HttpResponse.json(userResponseFixture);
  }),

  http.post('/api/v1/auth/register', () => {
    signedIn = true;
    return HttpResponse.json(userResponseFixture, { status: 201 });
  }),

  http.post('/api/v1/auth/logout', () => {
    signedIn = false;
    return new HttpResponse(null, { status: 204 });
  }),

  http.get('/api/v1/trip', () => HttpResponse.json(tripResponseGoodFixture)),

  http.get('/api/v1/model', () => HttpResponse.json(modelResponseFixture)),

  http.get('/api/v1/model/versions/:id', () => HttpResponse.json(modelVersionDetailResponseFixture)),

  http.get('/api/v1/commutes', () => {
    if (!signedIn) {
      return HttpResponse.json(
        { error: { code: 'unauthorized', message: 'Not signed in' } },
        { status: 401 },
      );
    }
    return HttpResponse.json(commuteListResponseFixture);
  }),

  http.post('/api/v1/commutes', async ({ request }) => {
    if (!signedIn) {
      return HttpResponse.json(
        { error: { code: 'unauthorized', message: 'Not signed in' } },
        { status: 401 },
      );
    }
    const body = (await request.json()) as CommuteCreateRequest;
    const origin = stationList.find((s) => s.id === body.origin_station_id) ?? stationList[0]!;
    const dest = stationList.find((s) => s.id === body.dest_station_id) ?? stationList[1]!;
    const commute: Commute = {
      id: '33333333-3333-3333-3333-333333333333',
      name: body.name,
      city: { slug: 'toronto', tz: 'America/Toronto' },
      origin: { id: origin.id, name: origin.name, lat: origin.lat, lon: origin.lon },
      dest: { id: dest.id, name: dest.name, lat: dest.lat, lon: dest.lon },
      depart_local_time: body.depart_local_time,
      ride_minutes: body.ride_minutes ?? 15,
      days_of_week: body.days_of_week,
      alert_enabled: body.alert_enabled ?? true,
      alert_lead_minutes: body.alert_lead_minutes ?? 20,
      threshold: body.threshold ?? 0.7,
      created_at: '2026-08-17T12:00:00Z',
      updated_at: '2026-08-17T12:00:00Z',
    };
    return HttpResponse.json({ commute }, { status: 201 });
  }),

  http.patch('/api/v1/commutes/:id', async ({ request, params }) => {
    if (!signedIn) {
      return HttpResponse.json(
        { error: { code: 'unauthorized', message: 'Not signed in' } },
        { status: 401 },
      );
    }
    const body = (await request.json()) as CommuteUpdateRequest;
    const commute: Commute = {
      ...commuteFixture,
      id: String(params.id),
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.depart_local_time !== undefined ? { depart_local_time: body.depart_local_time } : {}),
      ...(body.ride_minutes !== undefined ? { ride_minutes: body.ride_minutes } : {}),
      ...(body.days_of_week !== undefined ? { days_of_week: body.days_of_week } : {}),
      ...(body.alert_enabled !== undefined ? { alert_enabled: body.alert_enabled } : {}),
      ...(body.alert_lead_minutes !== undefined
        ? { alert_lead_minutes: body.alert_lead_minutes }
        : {}),
      ...(body.threshold !== undefined ? { threshold: body.threshold } : {}),
    };
    return HttpResponse.json({ commute });
  }),

  http.delete('/api/v1/commutes/:id', () => new HttpResponse(null, { status: 204 })),

  http.get('/api/v1/push/vapid-public-key', () => HttpResponse.json(vapidKeyResponseFixture)),

  http.post('/api/v1/push/subscriptions', () =>
    HttpResponse.json(pushSubscribeResponseFixture, { status: 201 }),
  ),

  http.delete('/api/v1/push/subscriptions', () => new HttpResponse(null, { status: 204 })),

  http.post('/api/v1/push/test', () => HttpResponse.json(pushTestResponseFixture, { status: 202 })),
];
