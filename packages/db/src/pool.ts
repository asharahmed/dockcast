/**
 * `pg.Pool` factory shared by every Node service (api, collector, workers-via-Node
 * tooling). Configures `pg`'s type parsers exactly once per process so numeric
 * types round-trip as JS `number` and `timestamptz` stays a `Date` (architecture.md
 * §4, plan.md WP-1).
 */
import pg from 'pg';

export type { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';

// Postgres OIDs for the builtin types we override. `timestamptz` (1184) is left
// alone: pg's default parser already returns a `Date`.
const OID_INT8 = 20;
const OID_FLOAT4 = 700;
const OID_FLOAT8 = 701;
const OID_NUMERIC = 1700;

let typeParsersConfigured = false;

function configureTypeParsers(): void {
  if (typeParsersConfigured) return;
  const toNumber = (value: string): number => Number(value);
  pg.types.setTypeParser(OID_INT8, toNumber);
  pg.types.setTypeParser(OID_NUMERIC, toNumber);
  pg.types.setTypeParser(OID_FLOAT4, toNumber);
  pg.types.setTypeParser(OID_FLOAT8, toNumber);
  typeParsersConfigured = true;
}

export interface CreatePoolOptions {
  /** Maximum pool size. Default 10. */
  max?: number;
  /** Sent to Postgres as `application_name` (visible in `pg_stat_activity`). */
  applicationName?: string;
}

/**
 * Create a `pg.Pool` for `databaseUrl`. Type parsers (`int8`, `numeric`,
 * `float4`, `float8` → `number`) are registered globally the first time this
 * is called; subsequent calls (or pools) reuse the same configuration.
 */
export function createPool(databaseUrl: string, opts: CreatePoolOptions = {}): pg.Pool {
  configureTypeParsers();
  return new pg.Pool({
    connectionString: databaseUrl,
    max: opts.max ?? 10,
    application_name: opts.applicationName,
  });
}
