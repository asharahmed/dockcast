/**
 * `auth_identities` table (`db/migrations/0003_auth_identities.sql`) — OAuth
 * provider identities linked to `users`. `docs/api.md` §5.
 */
import type { Pool } from '@dockcast/db';
import { many, maybeOne, none } from '@dockcast/db';

export type Provider = 'google' | 'apple';

export async function findIdentityUserId(
  pool: Pool,
  provider: Provider,
  subject: string,
): Promise<string | null> {
  const row = await maybeOne<{ user_id: string }>(
    pool,
    `SELECT user_id FROM auth_identities WHERE provider = $1 AND subject = $2`,
    [provider, subject],
  );
  return row?.user_id ?? null;
}

export async function linkIdentity(
  pool: Pool,
  provider: Provider,
  subject: string,
  userId: string,
  email: string,
): Promise<void> {
  await none(
    pool,
    `INSERT INTO auth_identities (provider, subject, user_id, email) VALUES ($1, $2, $3, $4)
     ON CONFLICT (provider, subject) DO NOTHING`,
    [provider, subject, userId, email],
  );
}

export interface IdentityRow {
  provider: Provider;
  email: string | null;
  created_at: Date;
}

export async function listIdentities(pool: Pool, userId: string): Promise<IdentityRow[]> {
  return many<IdentityRow>(
    pool,
    `SELECT provider, email, created_at FROM auth_identities WHERE user_id = $1 ORDER BY provider`,
    [userId],
  );
}

/** Returns how many rows were removed. */
export async function deleteProviderIdentities(
  pool: Pool,
  userId: string,
  provider: Provider,
): Promise<number> {
  const rows = await many<{ provider: string }>(
    pool,
    `DELETE FROM auth_identities WHERE user_id = $1 AND provider = $2 RETURNING provider`,
    [userId, provider],
  );
  return rows.length;
}
