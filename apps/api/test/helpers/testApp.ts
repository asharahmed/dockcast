/** Spins up a throwaway DB (migrated + seeded) and a `createApp()` instance wired to it, for supertest. */
import type { Express } from 'express';
import pino from 'pino';
import { createPool, migrate, type Pool } from '@dockcast/db';
import { createApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import type { PushTransport } from '../../src/alerts/sender.js';
import { createThrowawayDb, type ThrowawayDb } from './throwawayDb.js';
import { seed, FIXED_NOW, type SeededData } from '../seed.js';

const DATABASE_URL_TEST = process.env.DATABASE_URL_TEST;

export interface TestContext {
  app: Express;
  pool: Pool;
  seeded: SeededData;
  now: Date;
  teardown: () => Promise<void>;
}

function testEnv(databaseUrl: string, overrides: Record<string, string>): NodeJS.ProcessEnv {
  return {
    ...process.env,
    DATABASE_URL: databaseUrl,
    PORT: '3000',
    SESSION_SECRET: 'x'.repeat(32),
    VAPID_PUBLIC_KEY: 'test-vapid-public-key',
    VAPID_PRIVATE_KEY: 'test-vapid-private-key',
    VAPID_SUBJECT: 'mailto:test@example.com',
    PUBLIC_BASE_URL: 'http://localhost:3000',
    WEB_DIST_DIR: '/nonexistent/dockcast-test-dist',
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    ...overrides,
  };
}

export async function setupTestApp(
  envOverrides: Record<string, string> = {},
  appOverrides: { pushTransport?: PushTransport; fetchImpl?: typeof fetch } = {},
): Promise<TestContext> {
  if (!DATABASE_URL_TEST) {
    throw new Error('DATABASE_URL_TEST must be set to run apps/api tests');
  }
  const throwaway: ThrowawayDb = await createThrowawayDb(DATABASE_URL_TEST);
  const pool = createPool(throwaway.databaseUrl, { applicationName: 'dockcast-api-test' });
  await migrate(pool);
  const seeded = await seed(pool);

  const config = loadConfig(testEnv(throwaway.databaseUrl, envOverrides));
  const logger = pino({ level: 'silent' });
  const app = createApp({
    pool,
    config,
    now: () => FIXED_NOW,
    logger,
    pushTransport: appOverrides.pushTransport,
    fetchImpl: appOverrides.fetchImpl,
  });

  return {
    app,
    pool,
    seeded,
    now: FIXED_NOW,
    async teardown() {
      await pool.end();
      await throwaway.drop();
    },
  };
}
