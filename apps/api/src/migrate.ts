/**
 * `dist/migrate.js` — runs pending migrations and exits 0/1. Used by compose
 * one-shots and CI (`docs/api.md` §9: "A second entry `dist/migrate.js` runs
 * migrations and exits 0/1").
 */
import { createPool, migrate } from '@dockcast/db';
import pino from 'pino';
import { loadConfig } from './config.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = pino({ level: config.logLevel });
  const pool = createPool(config.databaseUrl, { applicationName: 'dockcast-migrate' });
  try {
    const applied = await migrate(pool, config.migrationsDir);
    logger.info({ applied }, 'migrations applied');
  } finally {
    await pool.end();
  }
}

const bootLogger = pino({ level: process.env.LOG_LEVEL ?? 'info' });
main().catch((err: unknown) => {
  bootLogger.fatal({ err }, 'migration failed');
  process.exitCode = 1;
});
