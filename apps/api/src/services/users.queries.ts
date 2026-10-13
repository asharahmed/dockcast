/**
 * `users` table. `docs/api.md` §5.
 */
import type { Pool } from '@dockcast/db';
import { maybeOne, none, one } from '@dockcast/db';

export interface UserRow {
  id: string;
  email: string;
  password_hash: string | null;
  created_at: Date;
  last_login_at: Date | null;
}

/** Case-insensitive lookup (`users_email_lower_uq`). */
export async function findUserByEmailCI(pool: Pool, email: string): Promise<UserRow | null> {
  return maybeOne<UserRow>(
    pool,
    `SELECT id, email, password_hash, created_at, last_login_at FROM users WHERE lower(email) = lower($1)`,
    [email],
  );
}

export async function findUserById(pool: Pool, id: string): Promise<UserRow | null> {
  return maybeOne<UserRow>(
    pool,
    `SELECT id, email, password_hash, created_at, last_login_at FROM users WHERE id = $1`,
    [id],
  );
}

/** `passwordHash` null → OAuth-provisioned user with no password login. */
export async function createUser(
  pool: Pool,
  email: string,
  passwordHash: string | null,
): Promise<UserRow> {
  return one<UserRow>(
    pool,
    `INSERT INTO users (email, password_hash) VALUES ($1, $2)
     RETURNING id, email, password_hash, created_at, last_login_at`,
    [email, passwordHash],
  );
}

export async function touchLastLogin(pool: Pool, userId: string, at: Date): Promise<void> {
  await none(pool, `UPDATE users SET last_login_at = $2 WHERE id = $1`, [userId, at]);
}

/**
 * Deletes the account and everything hanging off it: commutes (and their alert history),
 * push subscriptions, linked Google/Apple identities and pending link handshakes all
 * reference `users` with ON DELETE CASCADE. Sessions are keyed by sid, not user, so every
 * session that belongs to this user (other devices included) is removed explicitly.
 * Returns whether a user row was deleted.
 */
export async function deleteUserAndSessions(pool: Pool, userId: string): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`DELETE FROM "session" WHERE sess->>'userId' = $1`, [userId]);
    const result = await client.query(`DELETE FROM users WHERE id = $1`, [userId]);
    await client.query('COMMIT');
    return (result.rowCount ?? 0) > 0;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
