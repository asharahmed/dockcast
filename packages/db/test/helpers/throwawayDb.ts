/** Creates/drops a throwaway database on the server addressed by `DATABASE_URL_TEST`. */
import { randomUUID } from 'node:crypto';
import pg from 'pg';

export interface ThrowawayDb {
  databaseUrl: string;
  drop(): Promise<void>;
}

export async function createThrowawayDb(baseUrl: string): Promise<ThrowawayDb> {
  const dbName = `dockcast_test_${randomUUID().replace(/-/g, '')}`;

  const admin = new pg.Client({ connectionString: baseUrl });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE "${dbName}"`);
  } finally {
    await admin.end();
  }

  const url = new URL(baseUrl);
  url.pathname = `/${dbName}`;

  return {
    databaseUrl: url.toString(),
    async drop() {
      const dropAdmin = new pg.Client({ connectionString: baseUrl });
      await dropAdmin.connect();
      try {
        await dropAdmin.query(
          'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()',
          [dbName],
        );
        await dropAdmin.query(`DROP DATABASE IF EXISTS "${dbName}"`);
      } finally {
        await dropAdmin.end();
      }
    },
  };
}
