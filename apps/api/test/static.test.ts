import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { setupTestApp, type TestContext } from './helpers/testApp.js';

const FAKE_DIST_DIR = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fake-dist');

describe('static SPA serving (docs/api.md §10)', () => {
  describe('with a built WEB_DIST_DIR', () => {
    let ctx: TestContext;

    beforeAll(async () => {
      ctx = await setupTestApp({ WEB_DIST_DIR: FAKE_DIST_DIR });
    }, 60_000);

    afterAll(async () => {
      await ctx.teardown();
    });

    it('serves index.html for a non-/api GET, with Cache-Control: no-cache', async () => {
      const res = await request(ctx.app).get('/some/spa/route');
      expect(res.status).toBe(200);
      expect(res.text).toContain('test-fixture-spa-shell');
      expect(res.headers['cache-control']).toBe('no-cache');
      expect(res.headers['cross-origin-resource-policy']).toBe('same-origin');
    });

    it('404s a missing file path instead of answering with the HTML shell', async () => {
      for (const path of ['/apple-touch-icon-missing.png', '/nope/favicon.ico', '/robots.txt']) {
        const res = await request(ctx.app).get(path);
        expect(res.status).toBe(404);
        expect(res.text).not.toContain('test-fixture-spa-shell');
      }
      // Extension-less routes, including ones with dots earlier in the path, still get the shell.
      const route = await request(ctx.app).get('/station/7000');
      expect(route.status).toBe(200);
      expect(route.text).toContain('test-fixture-spa-shell');
    });

    it('serves hashed assets with immutable, long-lived caching', async () => {
      const res = await request(ctx.app).get('/assets/app.abc123.js');
      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    });

    it('serves un-hashed public files with a short, revalidating cache', async () => {
      const res = await request(ctx.app).get('/favicon.svg');
      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toBe('public, max-age=3600');
      // Loadable outside the page context (iOS home-screen icon fetcher).
      expect(res.headers['cross-origin-resource-policy']).toBe('cross-origin');
    });

    it('serves sw.js with no-cache and Service-Worker-Allowed: /', async () => {
      const res = await request(ctx.app).get('/sw.js');
      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toBe('no-cache');
      expect(res.headers['service-worker-allowed']).toBe('/');
    });

    it('unknown /api/* route still gets the JSON 404 envelope, not the SPA shell', async () => {
      const res = await request(ctx.app).get('/api/v1/does-not-exist');
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('not_found');
    });
  });

  describe('without a built WEB_DIST_DIR (WP-9/10 not built yet)', () => {
    let ctx: TestContext;

    beforeAll(async () => {
      ctx = await setupTestApp({ WEB_DIST_DIR: '/nonexistent/dockcast-test-dist' });
    }, 60_000);

    afterAll(async () => {
      await ctx.teardown();
    });

    it('non-/api GET routes 404 (static mounting was skipped)', async () => {
      const res = await request(ctx.app).get('/some/spa/route');
      expect(res.status).toBe(404);
    });

    it('/api/v1 routes still work normally', async () => {
      const res = await request(ctx.app).get('/api/v1/health');
      expect(res.status).toBe(200);
    });
  });
});
