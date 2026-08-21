import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { createPool } from '../src/pool.js';
import { currentVersion, latestVersion, migrate, waitForSchema } from '../src/migrate.js';
import { many, one } from '../src/sql.js';
import { createThrowawayDb, type ThrowawayDb } from './helpers/throwawayDb.js';

const DATABASE_URL_TEST = process.env.DATABASE_URL_TEST;

if (!DATABASE_URL_TEST) {
  console.log('Skipping migrate.db.test.ts: DATABASE_URL_TEST is not set.');
}

interface CountRow {
  n: number;
}

describe.skipIf(!DATABASE_URL_TEST)('migrate() against a throwaway database', () => {
  let throwaway: ThrowawayDb;
  let pool: Pool;

  beforeAll(async () => {
    throwaway = await createThrowawayDb(DATABASE_URL_TEST as string);
    pool = createPool(throwaway.databaseUrl, { max: 5, applicationName: 'dockcast-db-test' });
  }, 30_000);

  afterAll(async () => {
    await pool.end();
    await throwaway.drop();
  }, 30_000);

  it('applies all migrations and creates the expected tables and hypertables', async () => {
    const applied = await migrate(pool);
    expect(applied).toEqual([
      { version: 1, name: 'init' },
      { version: 2, name: 'model_eval_tier' },
      { version: 3, name: 'auth_identities' },
      { version: 4, name: 'multi_city' },
      { version: 5, name: 'oauth_handshakes' },
    ]);

    const tables = await many<{ table_name: string }>(
      pool,
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'",
    );
    const tableNames = tables.map((r) => r.table_name);
    expect(tableNames).toEqual(
      expect.arrayContaining([
        'cities',
        'stations',
        'station_current',
        'station_snapshots',
        'poll_log',
        'forecasts_latest',
        'forecast_history',
        'forecast_labels',
        'schema_migrations',
      ]),
    );

    const hypertables = await many<{ hypertable_name: string }>(
      pool,
      'SELECT hypertable_name FROM timescaledb_information.hypertables',
    );
    const hyperNames = hypertables.map((r) => r.hypertable_name).sort();
    expect(hyperNames).toEqual(
      ['forecast_history', 'forecast_labels', 'poll_log', 'station_snapshots'].sort(),
    );
  });

  it('is a no-op on a second run', async () => {
    const before = await one<CountRow>(pool, 'SELECT count(*)::int AS n FROM schema_migrations');
    const applied = await migrate(pool);
    expect(applied).toEqual([]);
    const after = await one<CountRow>(pool, 'SELECT count(*)::int AS n FROM schema_migrations');
    expect(after.n).toBe(before.n);
  });

  it('waitForSchema resolves immediately when already current', async () => {
    await expect(
      waitForSchema(pool, undefined, { timeoutMs: 1000, intervalMs: 100 }),
    ).resolves.toBeUndefined();
    expect(await currentVersion(pool)).toBe(latestVersion());
  });

  // Keep this last: it corrupts schema_migrations for this throwaway database.
  it('throws when an applied migration file checksum no longer matches', async () => {
    await pool.query("UPDATE schema_migrations SET checksum = 'tampered' WHERE version = 1");
    await expect(migrate(pool)).rejects.toThrow(/checksum mismatch/i);
  });
});

describe.skipIf(!DATABASE_URL_TEST)('migrate() concurrency', () => {
  let throwaway: ThrowawayDb;
  let poolA: Pool;
  let poolB: Pool;

  beforeAll(async () => {
    throwaway = await createThrowawayDb(DATABASE_URL_TEST as string);
    poolA = createPool(throwaway.databaseUrl, { applicationName: 'dockcast-db-test-a' });
    poolB = createPool(throwaway.databaseUrl, { applicationName: 'dockcast-db-test-b' });
  }, 30_000);

  afterAll(async () => {
    await poolA.end();
    await poolB.end();
    await throwaway.drop();
  }, 30_000);

  it('applies the migration exactly once when two migrate() calls race', async () => {
    const [a, b] = await Promise.all([migrate(poolA), migrate(poolB)]);
    const combinedApplied = [...a, ...b];
    expect(combinedApplied).toEqual([
      { version: 1, name: 'init' },
      { version: 2, name: 'model_eval_tier' },
      { version: 3, name: 'auth_identities' },
      { version: 4, name: 'multi_city' },
      { version: 5, name: 'oauth_handshakes' },
    ]);

    const count = await one<CountRow>(poolA, 'SELECT count(*)::int AS n FROM schema_migrations');
    expect(count.n).toBe(5);
  });
});
