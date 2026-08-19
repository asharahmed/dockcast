/**
 * Dependency shapes shared between `app.ts` and `routes/*.ts`, split out to
 * avoid a circular import between them.
 */
import type { Pool } from '@dockcast/db';
import type { Logger } from 'pino';
import type { Config } from './config.js';
import type { PushTransport } from './alerts/sender.js';

/**
 * Public `createApp(deps)` contract (`docs/plan.md` WP-7/WP-8). `now` is
 * optional; `createApp` defaults it. `pushTransport` is optional; `createApp`
 * defaults it to the real `web-push`-backed transport (`alerts/sender.ts`) —
 * tests override it to avoid real network calls.
 */
export interface AppDeps {
  pool: Pool;
  config: Config;
  now?: () => Date;
  logger: Logger;
  pushTransport?: PushTransport;
  /** Outbound HTTP for OAuth token exchange; defaults to global `fetch` — tests inject a fake. */
  fetchImpl?: typeof fetch;
}

/** What route factories receive: `AppDeps` with `now`/`pushTransport` resolved to concrete values. */
export interface RouteDeps {
  pool: Pool;
  config: Config;
  now: () => Date;
  logger: Logger;
  pushTransport: PushTransport;
  fetchImpl: typeof fetch;
}
