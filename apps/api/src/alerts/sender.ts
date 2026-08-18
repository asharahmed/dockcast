/**
 * Wraps `web-push` behind an injectable transport so routes/scheduler code
 * and tests never depend on real network calls. `docs/api.md` §7 (payload
 * shape, TTL/urgency), §8 point 6 (404/410 -> delete; other errors ->
 * `failed_count += 1`, delete at >= 5).
 */
import webpush from 'web-push';
import type { Pool } from '@dockcast/db';
import type { Config } from '../config.js';
import {
  deleteSubscription,
  incrementFailedCount,
  markSubscriptionUsed,
  type PushSubscriptionRow,
} from '../services/push.queries.js';

const FAILURE_THRESHOLD = 5;
const PUSH_TTL_SECONDS = 3600;

/** `docs/api.md` §7: push payload shape. */
export interface PushPayload {
  title: string;
  body: string;
  url: string;
  tag: string;
}

export interface TransportResult {
  statusCode: number;
}

export type PushTransport = (
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
  payload: string,
  opts: { TTL: number; urgency: 'high' },
) => Promise<TransportResult>;

/**
 * Real transport, wrapping `web-push`. `setVapidDetails` is called lazily on
 * first use (not at construction time) so building this closure has no side
 * effects — tests always inject a fake transport instead and must never
 * trigger real VAPID key validation against the placeholder keys
 * `test/helpers/testApp.ts` sets.
 */
export function createWebPushTransport(config: Config): PushTransport {
  return async (subscription, payload, opts) => {
    webpush.setVapidDetails(config.vapidSubject, config.vapidPublicKey, config.vapidPrivateKey);
    try {
      const result = await webpush.sendNotification(subscription, payload, opts);
      return { statusCode: result.statusCode };
    } catch (err) {
      if (err instanceof webpush.WebPushError) {
        return { statusCode: err.statusCode };
      }
      throw err;
    }
  };
}

async function sendOne(
  sub: PushSubscriptionRow,
  body: string,
  transport: PushTransport,
): Promise<TransportResult> {
  try {
    return await transport(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      body,
      { TTL: PUSH_TTL_SECONDS, urgency: 'high' },
    );
  } catch {
    // An opaque transport failure (e.g. a network error, as opposed to a
    // well-formed non-2xx HTTP response) is bucketed with "other errors"
    // below — some non-2xx status that isn't 404/410.
    return { statusCode: 0 };
  }
}

/**
 * Sends `payload` to every subscription in `subscriptions`. Returns the
 * number successfully pushed to (2xx) — `alert_events.delivered` /
 * `POST /push/test`'s `sent`.
 */
export async function sendToSubscriptions(
  pool: Pool,
  subscriptions: readonly PushSubscriptionRow[],
  payload: PushPayload,
  transport: PushTransport,
  now: Date,
): Promise<number> {
  const body = JSON.stringify(payload);
  let delivered = 0;

  for (const sub of subscriptions) {
    const result = await sendOne(sub, body, transport);
    if (result.statusCode >= 200 && result.statusCode < 300) {
      delivered += 1;
      await markSubscriptionUsed(pool, sub.id, now);
    } else if (result.statusCode === 404 || result.statusCode === 410) {
      await deleteSubscription(pool, sub.id);
    } else {
      const failedCount = await incrementFailedCount(pool, sub.id);
      if (failedCount >= FAILURE_THRESHOLD) {
        await deleteSubscription(pool, sub.id);
      }
    }
  }
  return delivered;
}
