import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { setupTestApp, type TestContext } from './helpers/testApp.js';

/** Response headers and error bodies that would help fingerprint the stack. */
function assertNoFingerprint(res: request.Response): void {
  expect(res.headers['x-powered-by']).toBeUndefined();
  expect(res.headers['server']).toBeUndefined();
  const body = res.text ?? '';
  expect(body).not.toMatch(/\bat \S+ \(.*:\d+:\d+\)/); // stack frame
  expect(body).not.toMatch(/node_modules|express|body-parser|SyntaxError|Unexpected token/i);
}

describe('response hygiene (production mode)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await setupTestApp({ NODE_ENV: 'production' });
  }, 60_000);

  afterAll(async () => {
    await ctx.teardown();
  });

  it('health carries no version and no framework headers', async () => {
    const res = await request(ctx.app).get('/api/v1/health');
    assertNoFingerprint(res);
    expect(res.body).not.toHaveProperty('version');
  });

  it('unknown api path: JSON envelope, no framework headers', async () => {
    const res = await request(ctx.app).get('/api/v1/nope');
    expect(res.status).toBe(404);
    assertNoFingerprint(res);
  });

  it('malformed JSON body: 400 with a fixed message, no parser text or stack', async () => {
    const res = await request(ctx.app)
      .post('/api/v1/auth/login')
      .set('X-Requested-With', 'fetch')
      .set('Content-Type', 'application/json')
      .send('{"a":');
    expect(res.status).toBe(400);
    assertNoFingerprint(res);
    expect(res.text).not.toMatch(/JSON/);
  });
});
