/**
 * `docs/api.md` §7 — /push/vapid-public-key, /push/subscriptions, /push/test.
 */
import { z } from 'zod';

export const pushSubscribeRequestSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string(),
    auth: z.string(),
  }),
  user_agent: z.string().optional(),
});
export type PushSubscribeRequest = z.infer<typeof pushSubscribeRequestSchema>;

/** `POST /push/subscriptions` → 201 `{ id }`. */
export const pushSubscribeResponseSchema = z.object({ id: z.string().uuid() });
export type PushSubscribeResponse = z.infer<typeof pushSubscribeResponseSchema>;

/** `DELETE /push/subscriptions` body. */
export const pushUnsubscribeRequestSchema = z.object({ endpoint: z.string().url() });
export type PushUnsubscribeRequest = z.infer<typeof pushUnsubscribeRequestSchema>;

/** `GET /push/vapid-public-key`. */
export const vapidKeyResponseSchema = z.object({ publicKey: z.string() });
export type VapidKeyResponse = z.infer<typeof vapidKeyResponseSchema>;

/** `POST /push/test` → 202. */
export const pushTestResponseSchema = z.object({ sent: z.number().int().nonnegative() });
export type PushTestResponse = z.infer<typeof pushTestResponseSchema>;
