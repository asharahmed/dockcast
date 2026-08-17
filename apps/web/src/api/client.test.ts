import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../mocks/server.js';
import { apiGet, apiPost, ApiError } from './client.js';

describe('api client', () => {
  it('throws an ApiError built from the error envelope on non-2xx', async () => {
    server.use(
      http.get('/api/v1/boom', () =>
        HttpResponse.json(
          { error: { code: 'validation_error', message: 'Nope' } },
          { status: 400 },
        ),
      ),
    );
    await expect(apiGet('/boom')).rejects.toMatchObject({
      status: 400,
      code: 'validation_error',
      message: 'Nope',
    });
    await expect(apiGet('/boom')).rejects.toBeInstanceOf(ApiError);
  });

  it('maps a network failure to code "network"', async () => {
    server.use(http.get('/api/v1/unreachable', () => HttpResponse.error()));
    await expect(apiGet('/unreachable')).rejects.toMatchObject({ status: 0, code: 'network' });
  });

  it('resolves 204 responses to undefined', async () => {
    server.use(http.post('/api/v1/noop', () => new HttpResponse(null, { status: 204 })));
    await expect(apiPost('/noop')).resolves.toBeUndefined();
  });

  it('sends X-Requested-With: fetch on every request', async () => {
    let seenHeader: string | null = null;
    server.use(
      http.get('/api/v1/echo-headers', ({ request }) => {
        seenHeader = request.headers.get('X-Requested-With');
        return HttpResponse.json({ ok: true });
      }),
    );
    await apiGet('/echo-headers');
    expect(seenHeader).toBe('fetch');
  });
});
