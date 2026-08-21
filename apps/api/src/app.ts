/**
 * `docs/api.md` — Express 5 app assembly. `docs/plan.md` WP-7 contract:
 * `createApp(deps: { pool, config, now?, logger })`.
 */
import express, { type Express } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import type { AppDeps, RouteDeps } from './deps.js';
import { requestId } from './middleware/requestId.js';
import { requireFetchHeader } from './middleware/requireFetchHeader.js';
import { createSessionMiddleware } from './middleware/session.js';
import { apiNotFoundHandler, errorHandler } from './middleware/errors.js';
import { healthRouter } from './routes/health.js';
import { citiesRouter } from './routes/cities.js';
import { stationsRouter } from './routes/stations.js';
import { tripRouter } from './routes/trip.js';
import { modelRouter } from './routes/model.js';
import { authRouter } from './routes/auth.js';
import { commutesRouter } from './routes/commutes.js';
import { pushRouter } from './routes/push.js';
import { createWebPushTransport } from './alerts/sender.js';
import { mountStatic } from './static.js';

export type { AppDeps, RouteDeps } from './deps.js';

export function createApp(deps: AppDeps): Express {
  const routeDeps: RouteDeps = {
    pool: deps.pool,
    config: deps.config,
    now: deps.now ?? ((): Date => new Date()),
    logger: deps.logger,
    pushTransport: deps.pushTransport ?? createWebPushTransport(deps.config),
    fetchImpl: deps.fetchImpl ?? fetch,
  };

  const app = express();
  app.set('trust proxy', deps.config.trustProxy);
  app.disable('x-powered-by');

  app.use(requestId);
  app.use(
    pinoHttp({
      logger: deps.logger,
      // Reuse the id `requestId` (mounted above) already assigned, rather than
      // letting pino-http generate its own.
      genReqId: (req) => req.id,
    }),
  );
  // Defaults restrict connect-src/img-src/worker-src to 'self', which blocks MapLibre's
  // fetches to the OpenFreeMap basemap (tiles.openfreemap.org: style JSON, vector tiles,
  // sprites, glyphs) and its web worker; ui-spec.md explicitly allows these as the only
  // non-API external requests. See WP-12 final report.
  //
  // On a plain-http request, helmet's default `upgrade-insecure-requests` rewrites every
  // subresource fetch — including same-origin /assets/*.js — to https://, which may serve
  // nothing (e.g. the Tailscale-IP access path at http://100.x.y.z:8088), white-screening
  // the SPA; localhost is exempt as a trustworthy origin, which is why local smoke tests
  // never hit this. HSTS over plain http is likewise meaningless. The same deployment can
  // serve both schemes at once (https://dockcast... via Caddy TLS and the plain-http IP
  // path), so decide per request: `req.secure` honours X-Forwarded-Proto under
  // `trust proxy`.
  const buildHelmet = (secure: boolean): ReturnType<typeof helmet> =>
    helmet({
      contentSecurityPolicy: {
        directives: {
          ...helmet.contentSecurityPolicy.getDefaultDirectives(),
          'connect-src': ["'self'", 'https://tiles.openfreemap.org'],
          'img-src': ["'self'", 'data:', 'https://tiles.openfreemap.org'],
          'worker-src': ["'self'", 'blob:'],
          ...(secure ? {} : { 'upgrade-insecure-requests': null }),
        },
      },
      ...(secure ? {} : { strictTransportSecurity: false }),
    });
  const helmetSecure = buildHelmet(true);
  const helmetPlain = buildHelmet(false);
  app.use((req, res, next) => (req.secure ? helmetSecure : helmetPlain)(req, res, next));
  app.use(requireFetchHeader);
  app.use(express.json());
  app.use(createSessionMiddleware(deps.pool, deps.config));

  app.use('/api/v1', healthRouter(routeDeps));
  app.use('/api/v1', citiesRouter(routeDeps));
  app.use('/api/v1', stationsRouter(routeDeps));
  app.use('/api/v1', tripRouter(routeDeps));
  app.use('/api/v1', modelRouter(routeDeps));
  app.use('/api/v1', authRouter(routeDeps));
  app.use('/api/v1', commutesRouter(routeDeps));
  app.use('/api/v1', pushRouter(routeDeps));
  // Unmatched /api/* paths — real routes above already responded, this only
  // runs for paths under /api that no router claimed.
  app.use('/api', apiNotFoundHandler);

  // Everything else: static SPA (docs/api.md §10).
  mountStatic(app, deps.config, deps.logger);

  app.use(errorHandler);

  return app;
}
