/**
 * `auth_identities` table (`db/migrations/0003_auth_identities.sql`) — OAuth
 * provider identities linked to `users`. `docs/api.md` §5.
 */
import type { Pool } from '@dockcast/db';
import { maybeOne, none } from '@dockcast/db';

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
