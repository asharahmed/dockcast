/**
 * Tiny row-shape helpers around `pg`'s `query()`, plus an `unnest(...)` fragment
 * builder for batched inserts/upserts (plan.md WP-1, collector-spec.md §3).
 */
import type { Pool, PoolClient, QueryResultRow } from 'pg';

export type Queryable = Pool | PoolClient;

/** Run `text`/`params`; throw unless exactly one row comes back. */
export async function one<T extends QueryResultRow>(
  db: Queryable,
  text: string,
  params: readonly unknown[] = [],
): Promise<T> {
  const result = await db.query<T>(text, params as unknown[]);
  if (result.rows.length !== 1) {
    throw new Error(`Expected exactly one row, got ${result.rows.length}. Query: ${text}`);
  }
  return result.rows[0] as T;
}

/** Run `text`/`params`; throw if more than one row comes back; `null` if zero. */
export async function maybeOne<T extends QueryResultRow>(
  db: Queryable,
  text: string,
  params: readonly unknown[] = [],
): Promise<T | null> {
  const result = await db.query<T>(text, params as unknown[]);
  if (result.rows.length > 1) {
    throw new Error(`Expected at most one row, got ${result.rows.length}. Query: ${text}`);
  }
  return result.rows[0] ?? null;
}

/** Run `text`/`params`; return every row (possibly empty). */
export async function many<T extends QueryResultRow>(
  db: Queryable,
  text: string,
  params: readonly unknown[] = [],
): Promise<T[]> {
  const result = await db.query<T>(text, params as unknown[]);
  return result.rows;
}

/** Run `text`/`params` for its side effect; discard any rows. */
export async function none(
  db: Queryable,
  text: string,
  params: readonly unknown[] = [],
): Promise<void> {
  await db.query(text, params as unknown[]);
}

export interface UnnestColumn {
  /** Property name read off each row object. */
  name: string;
  /** Postgres element type, e.g. `'int'`, `'timestamptz'`, `'smallint'`, `'boolean'`. */
  type: string;
}

export interface UnnestParams {
  /** `unnest($1::type[], $2::type[], ...)` — splice directly after `SELECT * FROM `. */
  placeholders: string;
  /** Column-major parameter arrays, one array per `columns` entry, aligned with `placeholders`. */
  values: unknown[][];
}

/**
 * Build an `unnest($1::t1[], $2::t2[], ...)` SQL fragment and the matching
 * column-major parameter arrays for a batch insert/upsert of `rows`. Missing
 * properties are sent as `null`.
 *
 * @example
 * ```ts
 * const { placeholders, values } = unnestParams(rows, [
 *   { name: 'station_pk', type: 'int' },
 *   { name: 'ts', type: 'timestamptz' },
 *   { name: 'bikes', type: 'smallint' },
 * ]);
 * await pool.query(
 *   `INSERT INTO station_current (station_pk, ts, bikes)
 *    SELECT * FROM ${placeholders}
 *    ON CONFLICT (station_pk) DO UPDATE SET ts = EXCLUDED.ts, bikes = EXCLUDED.bikes`,
 *   values,
 * );
 * ```
 */
export function unnestParams(
  rows: Record<string, unknown>[],
  columns: UnnestColumn[],
): UnnestParams {
  const placeholders = `unnest(${columns
    .map((c, i) => `$${i + 1}::${c.type}[]`)
    .join(', ')})`;
  const values = columns.map((c) => rows.map((row) => row[c.name] ?? null));
  return { placeholders, values };
}
