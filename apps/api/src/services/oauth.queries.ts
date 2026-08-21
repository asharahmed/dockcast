/**
 * `oauth_handshakes` (`db/migrations/0005_oauth_handshakes.sql`) — in-flight
 * OAuth state, server-side and keyed by the unguessable single-use `state`.
 * Session-independent because Apple's form_post callback carries no Lax
 * cookie. `docs/api.md` §5.
 */
import type { Pool } from '@dockcast/db';
import { maybeOne, none } from '@dockcast/db';
import type { Provider } from './identities.queries.js';

const TTL_MINUTES = 15;

export interface Handshake {
  provider: Provider;
  nonce: string;
  verifier: string | null;
  next: string;
  /** Set when the start request was made by a signed-in user linking a provider (docs/api.md §5). */
  link_user_id: string | null;
}

export async function createHandshake(
  pool: Pool,
  state: string,
  handshake: Handshake,
): Promise<void> {
  // Opportunistic pruning keeps the table from accumulating abandoned rows.
  await none(pool, `DELETE FROM oauth_handshakes WHERE created_at < now() - interval '${TTL_MINUTES} minutes'`);
  await none(
    pool,
    `INSERT INTO oauth_handshakes (state, provider, nonce, verifier, next, link_user_id)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [state, handshake.provider, handshake.nonce, handshake.verifier, handshake.next, handshake.link_user_id],
  );
}

/** Single-use: the row is deleted as it is read. Expired rows resolve to null. */
export async function consumeHandshake(
  pool: Pool,
  state: string,
  provider: Provider,
): Promise<Handshake | null> {
  const row = await maybeOne<Handshake>(
    pool,
    `DELETE FROM oauth_handshakes
     WHERE state = $1 AND provider = $2 AND created_at >= now() - interval '${TTL_MINUTES} minutes'
     RETURNING provider, nonce, verifier, next, link_user_id`,
    [state, provider],
  );
  return row;
}
