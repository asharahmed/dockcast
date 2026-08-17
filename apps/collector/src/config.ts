/**
 * zod-validated environment configuration (`docs/collector-spec.md` §7).
 * Invalid config prints the zod issues and exits 1.
 */
import { z } from 'zod';

const logLevelSchema = z.enum(['fatal', 'error', 'warn', 'info', 'debug']);
export type LogLevel = z.infer<typeof logLevelSchema>;

const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  LOG_LEVEL: logLevelSchema.default('info'),
  HEALTHCHECKS_COLLECTOR_URL: z.string().url().optional(),
  POLL_INTERVAL_MS: z.coerce.number().int().min(10_000).default(60_000),
  INFO_INTERVAL_MS: z.coerce.number().int().min(60_000).default(3_600_000),
  WEATHER_INTERVAL_MS: z.coerce.number().int().min(300_000).default(1_800_000),
  CITIES: z.string().optional(),
  MIGRATIONS_DIR: z.string().optional(),
  HTTP_TIMEOUT_MS: z.coerce.number().int().positive().default(8_000),
});

export interface CollectorConfig {
  databaseUrl: string;
  logLevel: LogLevel;
  healthchecksCollectorUrl: string | undefined;
  pollIntervalMs: number;
  infoIntervalMs: number;
  weatherIntervalMs: number;
  /** Slugs to filter to; `undefined` = all active cities. */
  cities: string[] | undefined;
  migrationsDir: string | undefined;
  httpTimeoutMs: number;
}

/** Parses `env` (defaults to `process.env`). On failure: prints issues to stderr, exits 1. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): CollectorConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    console.error('Invalid collector configuration:');
    for (const issue of parsed.error.issues) {
      console.error(`  ${issue.path.join('.')}: ${issue.message}`);
    }
    process.exit(1);
  }

  const data = parsed.data;
  const cities = data.CITIES
    ? data.CITIES.split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
    : undefined;

  return {
    databaseUrl: data.DATABASE_URL,
    logLevel: data.LOG_LEVEL,
    healthchecksCollectorUrl: data.HEALTHCHECKS_COLLECTOR_URL,
    pollIntervalMs: data.POLL_INTERVAL_MS,
    infoIntervalMs: data.INFO_INTERVAL_MS,
    weatherIntervalMs: data.WEATHER_INTERVAL_MS,
    cities: cities && cities.length > 0 ? cities : undefined,
    migrationsDir: data.MIGRATIONS_DIR,
    httpTimeoutMs: data.HTTP_TIMEOUT_MS,
  };
}
