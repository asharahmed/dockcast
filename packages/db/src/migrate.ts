/**
 * SQL migrator: applies `db/migrations/NNNN_*.sql` files in ascending order,
 * tracked in `schema_migrations`, guarded by a Postgres advisory lock so
 * concurrent processes never race (plan.md WP-1).
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Pool, PoolClient } from 'pg';

/** Arbitrary but fixed key for `pg_advisory_lock` — must be stable across all callers. */
const ADVISORY_LOCK_KEY = 727272;

const MIGRATION_FILE_RE = /^(\d{4})_([^.]+)\.sql$/;

export interface MigrationFile {
  version: number;
  name: string;
  fileName: string;
  path: string;
}

export interface AppliedMigration {
  version: number;
  name: string;
}

export interface WaitForSchemaOptions {
  /** Give up and throw after this many ms. Default 300_000 (5 min). */
  timeoutMs?: number;
  /** Poll interval in ms. Default 2_000. */
  intervalMs?: number;
}

/** Walk up from `startDir` until a directory containing `pnpm-workspace.yaml` (the repo root) is found. */
function findRepoRoot(startDir: string): string {
  let dir = startDir;
  for (;;) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error(
        `Could not locate the repo root (a directory containing pnpm-workspace.yaml) walking up from ${startDir}`,
      );
    }
    dir = parent;
  }
}

function packageDefaultMigrationsDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(findRepoRoot(here), 'db', 'migrations');
}

/** `dir` param wins; else `MIGRATIONS_DIR` env; else `<repo>/db/migrations`. */
function resolveMigrationsDir(dir?: string): string {
  if (dir !== undefined) return dir;
  if (process.env.MIGRATIONS_DIR) return process.env.MIGRATIONS_DIR;
  return packageDefaultMigrationsDir();
}

function listMigrationFiles(dir: string): MigrationFile[] {
  const files: MigrationFile[] = [];
  for (const fileName of readdirSync(dir)) {
    const match = MIGRATION_FILE_RE.exec(fileName);
    if (!match) continue;
    const versionStr = match[1];
    const name = match[2];
    if (versionStr === undefined || name === undefined) continue;
    files.push({
      version: Number.parseInt(versionStr, 10),
      name,
      fileName,
      path: join(dir, fileName),
    });
  }
  files.sort((a, b) => a.version - b.version);
  return files;
}

function checksumOf(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

/** Highest migration version present in `dir` (0 if none). Same `dir` resolution as `migrate`. */
export function latestVersion(dir?: string): number {
  const files = listMigrationFiles(resolveMigrationsDir(dir));
  return files.reduce((max, f) => Math.max(max, f.version), 0);
}

function isUndefinedTableError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: unknown }).code === '42P01'
  );
}

/** Highest applied version recorded in `schema_migrations` (0 if the table doesn't exist yet). */
export async function currentVersion(pool: Pool | PoolClient): Promise<number> {
  try {
    const result = await pool.query<{ max: number | null }>(
      'SELECT max(version) AS max FROM schema_migrations',
    );
    return result.rows[0]?.max ?? 0;
  } catch (err) {
    if (isUndefinedTableError(err)) return 0;
    throw err;
  }
}

async function ensureMigrationsTable(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version     integer PRIMARY KEY,
      name        text NOT NULL,
      checksum    text NOT NULL,
      applied_at  timestamptz NOT NULL DEFAULT now()
    )
  `);
}

/**
 * Apply every `NNNN_*.sql` file in `dir` not yet recorded in `schema_migrations`,
 * in ascending version order, each in its own transaction. The whole run is
 * serialized across processes via `pg_advisory_lock(727272)` on a dedicated
 * connection. An already-applied file whose current sha256 no longer matches
 * the recorded checksum is fatal (thrown before anything is applied).
 *
 * Returns the migrations newly applied by this call (empty if none were pending).
 */
export async function migrate(pool: Pool, dir?: string): Promise<AppliedMigration[]> {
  const migrationsDir = resolveMigrationsDir(dir);
  const files = listMigrationFiles(migrationsDir);
  const loaded = files.map((file) => {
    const content = readFileSync(file.path, 'utf8');
    return { file, content, checksum: checksumOf(content) };
  });

  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [ADVISORY_LOCK_KEY]);
    try {
      await ensureMigrationsTable(client);

      const appliedResult = await client.query<{ version: number; name: string; checksum: string }>(
        'SELECT version, name, checksum FROM schema_migrations',
      );
      const appliedByVersion = new Map(appliedResult.rows.map((r) => [r.version, r]));

      for (const { file, checksum } of loaded) {
        const applied = appliedByVersion.get(file.version);
        if (applied && applied.checksum !== checksum) {
          throw new Error(
            `Checksum mismatch for already-applied migration ${file.fileName}: ` +
              `recorded ${applied.checksum}, current file hashes to ${checksum}. ` +
              'The applied migration file must not be modified after it has run.',
          );
        }
      }

      const newlyApplied: AppliedMigration[] = [];
      for (const { file, content, checksum } of loaded) {
        if (appliedByVersion.has(file.version)) continue;
        await client.query('BEGIN');
        try {
          await client.query(content);
          await client.query(
            'INSERT INTO schema_migrations (version, name, checksum, applied_at) VALUES ($1, $2, $3, now())',
            [file.version, file.name, checksum],
          );
          await client.query('COMMIT');
        } catch (err) {
          await client.query('ROLLBACK');
          throw err;
        }
        newlyApplied.push({ version: file.version, name: file.name });
      }
      return newlyApplied;
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [ADVISORY_LOCK_KEY]);
    }
  } finally {
    client.release();
  }
}

/**
 * Poll `currentVersion(pool)` every `intervalMs` until it reaches `latestVersion(dir)`;
 * resolves immediately if already current. Throws after `timeoutMs`. Used by
 * collector/workers at boot (exit 1 on throw — the process supervisor retries).
 */
export async function waitForSchema(
  pool: Pool,
  dir?: string,
  opts: WaitForSchemaOptions = {},
): Promise<void> {
  const timeoutMs = opts.timeoutMs ?? 300_000;
  const intervalMs = opts.intervalMs ?? 2_000;
  const migrationsDir = resolveMigrationsDir(dir);
  const target = latestVersion(migrationsDir);
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    const current = await currentVersion(pool);
    if (current >= target) return;
    if (Date.now() >= deadline) {
      throw new Error(
        `Timed out after ${timeoutMs}ms waiting for schema_migrations to reach version ${target} ` +
          `(currently ${current})`,
      );
    }
    await new Promise<void>((resolve) => setTimeout(resolve, intervalMs));
  }
}
