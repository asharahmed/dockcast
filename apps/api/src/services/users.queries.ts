/**
 * `users` table. `docs/api.md` §5.
 */
import type { Pool } from '@dockcast/db';
import { maybeOne, none, one } from '@dockcast/db';

export interface UserRow {
  id: string;
  email: string;
  password_hash: string;
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

export async function createUser(
  pool: Pool,
  email: string,
  passwordHash: string,
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
