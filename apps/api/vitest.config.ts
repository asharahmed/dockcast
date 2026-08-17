/**
 * Every test file spins up its own throwaway Postgres database (migrate +
 * seed) against the same `timescaledb-ha` server. Running files fully in
 * parallel (vitest's default) causes 7 concurrent `CREATE EXTENSION
 * timescaledb` / hypertable-creation sequences to contend for the same
 * server, which was observed to blow well past a 60s hook timeout on a
 * resource-constrained dev VM. `fileParallelism: false` runs files
 * sequentially instead — slower wall-clock, but reliable.
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    fileParallelism: false,
    hookTimeout: 60_000,
    testTimeout: 30_000,
  },
});
