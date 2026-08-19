/**
 * `docs/api.md` §10 — static asset serving + SPA fallback.
 */
import { existsSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import express, { type Express } from 'express';
import type { Logger } from 'pino';
import type { Config } from './config.js';

/**
 * Mounts `apps/web/dist` (hashed assets immutable-cached, `index.html`/`sw.js`
 * `no-cache`, `sw.js` also gets `Service-Worker-Allowed: /`) and a terminal
 * SPA-fallback middleware. Must be mounted after the `/api/v1` routers and
 * the `/api` 404 handler in `app.ts` — everything that reaches this point is
 * a non-`/api` request. If `config.webDistDir` doesn't exist (e.g. the web
 * app hasn't been built yet), static file serving is skipped with a warning
 * and the fallback responds 404.
 */
export function mountStatic(app: Express, config: Config, logger: Logger): void {
  const distExists = existsSync(config.webDistDir);
  if (!distExists) {
    logger.warn(
      { webDistDir: config.webDistDir },
      'WEB_DIST_DIR does not exist; skipping static file serving',
    );
  } else {
    app.use(
      express.static(config.webDistDir, {
        index: false,
        setHeaders(res, filePath) {
          const base = basename(filePath);
          if (base === 'index.html') {
            res.setHeader('Cache-Control', 'no-cache');
          } else if (base === 'sw.js') {
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Service-Worker-Allowed', '/');
          } else if (dirname(filePath).endsWith(join(config.webDistDir, 'assets'))) {
            // Vite content-hashed bundles: the URL changes when the content does.
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          } else {
            // Un-hashed files copied from public/ (favicon, icons, manifest):
            // must pick up changes on redeploy, so revalidate hourly via ETag.
            res.setHeader('Cache-Control', 'public, max-age=3600');
          }
        },
      }),
    );
  }

  const indexHtmlPath = join(config.webDistDir, 'index.html');

  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      next();
      return;
    }
    if (!distExists) {
      res.status(404).send('Not found');
      return;
    }
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(indexHtmlPath, (err) => {
      if (err) next(err);
    });
  });
}
