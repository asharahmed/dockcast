/**
 * Dependency shapes shared between `app.ts` and `routes/*.ts`, split out to
 * avoid a circular import between them.
 */
import type { Pool } from '@dockcast/db';
import type { Logger } from 'pino';
import type { Config } from './config.js';

/** Public `createApp(deps)` contract (`docs/plan.md` WP-7). `now` is optional; `createApp` defaults it. */
export interface AppDeps {
  pool: Pool;
  config: Config;
  now?: () => Date;
  logger: Logger;
}

/** What route factories receive: `AppDeps` with `now` resolved to a concrete function. */
export interface RouteDeps {
  pool: Pool;
  config: Config;
  now: () => Date;
  logger: Logger;
}
