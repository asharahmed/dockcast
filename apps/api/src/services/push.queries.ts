/**
 * `push_subscriptions` table. `docs/api.md` §7, §8 point 6 (failure handling).
 */
import type { Pool } from '@dockcast/db';
import { many, maybeOne, none, one } from '@dockcast/db';

export interface PushSubscriptionRow {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  failed_count: number;
}

export async function listSubscriptionsForUser(
  pool: Pool,
  userId: string,
): Promise<PushSubscriptionRow[]> {
  return many<PushSubscriptionRow>(
    pool,
    `SELECT id, user_id, endpoint, p256dh, auth, failed_count
     FROM push_subscriptions WHERE user_id = $1`,
    [userId],
  );
}

export interface UpsertSubscriptionResult {
  id: string;
  /** `true` for a brand-new row; `false` when an existing `endpoint` row was updated/re-assigned. */
  inserted: boolean;
}

/**
 * `docs/api.md` §7: new endpoint -> 201; existing endpoint for the same user
 * -> 200 (idempotent); existing endpoint for another user -> re-assigned to
 * the current user, 200. A single `ON CONFLICT (endpoint)` upsert covers all
 * three (`xmax = 0` distinguishes an actual insert from a conflict-update).
 */
export async function upsertSubscription(
  pool: Pool,
  args: { userId: string; endpoint: string; p256dh: string; auth: string; userAgent: string | null },
): Promise<UpsertSubscriptionResult> {
  return one<UpsertSubscriptionResult>(
    pool,
    `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (endpoint) DO UPDATE SET
       user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth,
       user_agent = EXCLUDED.user_agent, failed_count = 0
     RETURNING id, (xmax = 0) AS inserted`,
    [args.userId, args.endpoint, args.p256dh, args.auth, args.userAgent],
  );
}

/** Idempotent: a no-op (still 204) if `endpoint` doesn't belong to `userId`. */
export async function deleteSubscriptionByEndpointForUser(
  pool: Pool,
  userId: string,
  endpoint: string,
): Promise<void> {
  await none(pool, `DELETE FROM push_subscriptions WHERE endpoint = $1 AND user_id = $2`, [
    endpoint,
    userId,
  ]);
}

export async function deleteSubscription(pool: Pool, id: string): Promise<void> {
  await none(pool, `DELETE FROM push_subscriptions WHERE id = $1`, [id]);
}

/** Atomically increments and returns the new `failed_count` (`Infinity` if the row is already gone). */
export async function incrementFailedCount(pool: Pool, id: string): Promise<number> {
  const row = await maybeOne<{ failed_count: number }>(
    pool,
    `UPDATE push_subscriptions SET failed_count = failed_count + 1 WHERE id = $1 RETURNING failed_count`,
    [id],
  );
  return row?.failed_count ?? Number.POSITIVE_INFINITY;
}

export async function markSubscriptionUsed(pool: Pool, id: string, at: Date): Promise<void> {
  await none(
    pool,
    `UPDATE push_subscriptions SET last_used_at = $2, failed_count = 0 WHERE id = $1`,
    [id, at],
  );
}
