/**
 * MSW request handlers for `/api/v1/*`, enabled in dev (`VITE_USE_MOCKS=1`)
 * and in tests. ui-spec.md §1 (WP-9: "build against MSW... handlers under
 * `apps/web/src/mocks/`").
 */
import { http, HttpResponse } from 'msw';
import {
  cityListResponseFixture,
  stationListResponseFixture,
  mapResponseFixture,
  stationDetailResponseFixture,
  stationHistoryResponseFixture,
  healthResponseFixture,
  userResponseFixture,
} from './fixtures.js';

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
];
