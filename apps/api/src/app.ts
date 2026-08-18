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
  app.use(helmet());
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
