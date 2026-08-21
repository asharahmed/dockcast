/**
 * `docs/api.md` §9 — process & config. Every env var is validated with zod at
 * boot; nothing reads `process.env` directly outside this module
 * (`docs/plan.md` §1 R10).
 */
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

/** Walk up from `startDir` until a directory containing `pnpm-workspace.yaml` (the repo root) is found. */
function findRepoRoot(startDir: string): string {
  let dir = startDir;
  for (;;) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error(
        `Could not locate the repo root (a directory containing pnpm-workspace.yaml) walking up from ${startDir}`,
      );
    }
    dir = parent;
  }
}

function repoRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return findRepoRoot(here);
}

/**
 * Express's `trust proxy` setting accepts a boolean, a hop-count number, or a
 * string (IP/CIDR/preset). `TRUST_PROXY` is always a string in the
 * environment; coerce `"true"`/`"false"`/numeric strings, otherwise pass the
 * raw string through (e.g. `"loopback"`, a CIDR, or a comma-separated list).
 */
const trustProxySchema = z
  .string()
  .default('1')
  .transform((value): string | number | boolean => {
    if (value === 'true') return true;
    if (value === 'false') return false;
    const n = Number(value);
    if (value.trim() !== '' && !Number.isNaN(n)) return n;
    return value;
  });

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),
  VAPID_PUBLIC_KEY: z.string().min(1, 'VAPID_PUBLIC_KEY is required'),
  VAPID_PRIVATE_KEY: z.string().min(1, 'VAPID_PRIVATE_KEY is required'),
  VAPID_SUBJECT: z.string().min(1, 'VAPID_SUBJECT is required'),
  PUBLIC_BASE_URL: z.string().url('PUBLIC_BASE_URL must be a valid URL'),
  WEB_DIST_DIR: z.string().min(1).optional(),
  MIGRATIONS_DIR: z.string().min(1).optional(),
  LOG_LEVEL: z.string().min(1).default('info'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  TRUST_PROXY: trustProxySchema,
  // OAuth sign-in is optional: with these unset, /auth/providers reports
  // google: false and the OAuth routes 404 (docs/api.md §5).
  GOOGLE_CLIENT_ID: z.string().min(1).optional(),
  GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
  // Sign in with Apple: all four set -> enabled. The .p8 key is stored with
  // literal \n escapes (env files are single-line); unescaped in loadConfig.
  APPLE_SERVICES_ID: z.string().min(1).optional(),
  APPLE_TEAM_ID: z.string().min(1).optional(),
  APPLE_KEY_ID: z.string().min(1).optional(),
  APPLE_PRIVATE_KEY: z.string().min(1).optional(),
});

export interface Config {
  port: number;
  databaseUrl: string;
  sessionSecret: string;
  vapidPublicKey: string;
  vapidPrivateKey: string;
  vapidSubject: string;
  publicBaseUrl: string;
  /** Absolute path to the built SPA. Default `<repo>/apps/web/dist`. */
  webDistDir: string;
  /** Absolute path to `db/migrations`. Default `<repo>/db/migrations`. */
  migrationsDir: string;
  logLevel: string;
  nodeEnv: 'development' | 'production' | 'test';
  trustProxy: string | number | boolean;
  /** Both set → Google sign-in enabled. */
  googleClientId: string | null;
  googleClientSecret: string | null;
  /** All four set → Sign in with Apple enabled. */
  appleServicesId: string | null;
  appleTeamId: string | null;
  appleKeyId: string | null;
  applePrivateKey: string | null;
}

/**
 * Parse and validate `env` (default `process.env`) into a {@link Config}.
 * Throws a descriptive `Error` on any invalid/missing var — callers let this
 * crash the boot process (`src/index.ts`).
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    throw new Error(`Invalid environment configuration:\n${parsed.error.toString()}`);
  }
  const data = parsed.data;
  // Only locate the repo root when a path actually needs defaulting: pruned
  // production images (`pnpm deploy --prod`) set both env vars and carry no
  // pnpm-workspace.yaml to walk up to.
  const root = data.WEB_DIST_DIR && data.MIGRATIONS_DIR ? null : repoRoot();

  return {
    port: data.PORT,
    databaseUrl: data.DATABASE_URL,
    sessionSecret: data.SESSION_SECRET,
    vapidPublicKey: data.VAPID_PUBLIC_KEY,
    vapidPrivateKey: data.VAPID_PRIVATE_KEY,
    vapidSubject: data.VAPID_SUBJECT,
    publicBaseUrl: data.PUBLIC_BASE_URL,
    webDistDir: data.WEB_DIST_DIR ?? join(root ?? repoRoot(), 'apps', 'web', 'dist'),
    migrationsDir: data.MIGRATIONS_DIR ?? join(root ?? repoRoot(), 'db', 'migrations'),
    logLevel: data.LOG_LEVEL,
    nodeEnv: data.NODE_ENV,
    trustProxy: data.TRUST_PROXY,
    googleClientId: data.GOOGLE_CLIENT_ID ?? null,
    googleClientSecret: data.GOOGLE_CLIENT_SECRET ?? null,
    appleServicesId: data.APPLE_SERVICES_ID ?? null,
    appleTeamId: data.APPLE_TEAM_ID ?? null,
    appleKeyId: data.APPLE_KEY_ID ?? null,
    applePrivateKey: data.APPLE_PRIVATE_KEY?.replace(/\\n/g, '\n') ?? null,
  };
}
