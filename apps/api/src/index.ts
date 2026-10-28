/**
 * @dockcast/api — Express 5 REST API. `docs/api.md` §9 boot order: config ->
 * migrate() -> app -> listen -> alert scheduler (`docs/plan.md` WP-8).
 * Exports nothing — this is a process entry point.
 */
import { createPool, migrate } from '@dockcast/db';
import pino from 'pino';
import { loadConfig } from './config.js';
import { createApp } from './app.js';
import { createWebPushTransport } from './alerts/sender.js';
import { startScheduler } from './alerts/scheduler.js';
import { LatencyTracker } from './status/latency.js';
import { startSampler } from './status/sampler.js';

/** `DEPLOYED_AT` (ISO 8601, set by the deploy) if valid and not in the future; else undefined. */
function parseDeployedAt(v: string | undefined): Date | undefined {
  if (!v) return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) || d.getTime() > Date.now() ? undefined : d;
}

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = pino({ level: config.logLevel });
  const pool = createPool(config.databaseUrl, { applicationName: 'dockcast-api' });

  try {
    await migrate(pool, config.migrationsDir);
  } catch (err) {
    await pool.end();
    throw err;
  }

  const pushTransport = createWebPushTransport(config);
  const latency = new LatencyTracker();
  const deployedAt = parseDeployedAt(process.env.DEPLOYED_AT) ?? new Date();
  const app = createApp({ pool, config, logger, pushTransport, deployedAt, latency });
  app.listen(config.port, () => {
    logger.info({ port: config.port }, 'dockcast-api listening');
  });
  startScheduler({ pool, logger, pushTransport });
  startSampler({ pool, logger, latency });
}

const bootLogger = pino({ level: process.env.LOG_LEVEL ?? 'info' });
main().catch((err: unknown) => {
  bootLogger.fatal({ err }, 'dockcast-api failed to start');
  process.exitCode = 1;
});
