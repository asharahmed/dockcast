/**
 * @dockcast/db — pg Pool factory, SQL migrator, typed query helpers used by
 * api + collector (see docs/architecture.md §3, docs/plan.md WP-1).
 *
 * This is a WP-0 placeholder so downstream packages have something to
 * typecheck and depend on. Real modules (pool.ts, migrate.ts, sql.ts,
 * bin/migrate.ts) land in WP-1.
 */
export const VERSION = '0.1.0' as const;
