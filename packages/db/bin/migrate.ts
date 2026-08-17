/**
 * `pnpm db:migrate` — reads DATABASE_URL, applies pending migrations, prints
 * the versions it applied (nothing if there was nothing pending), and exits
 * 0 on success / 1 on failure. Run via `tsx` (see root package.json).
 */
import { createPool } from '../src/pool.js';
import { migrate } from '../src/migrate.js';

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL is required');
    process.exitCode = 1;
    return;
  }

  const pool = createPool(databaseUrl, { applicationName: 'dockcast-migrate' });
  try {
    const applied = await migrate(pool);
    for (const m of applied) {
      console.log(`applied ${String(m.version).padStart(4, '0')}_${m.name}`);
    }
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
  process.exitCode = 1;
});
