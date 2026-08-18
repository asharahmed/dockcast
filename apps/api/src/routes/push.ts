/**
 * `docs/api.md` §7 — /push/vapid-public-key, /push/subscriptions, /push/test.
 */
import { Router } from 'express';
import {
  pushSubscribeRequestSchema,
  pushUnsubscribeRequestSchema,
  vapidKeyResponseSchema,
  pushSubscribeResponseSchema,
  pushTestResponseSchema,
  type VapidKeyResponse,
  type PushSubscribeResponse,
  type PushTestResponse,
} from '@dockcast/shared';
import type { RouteDeps } from '../deps.js';
import { sendJson } from '../lib/respond.js';
import { parseBody } from '../lib/validate.js';
import { requireAuth } from '../middleware/requireAuth.js';
import {
  upsertSubscription,
  deleteSubscriptionByEndpointForUser,
  listSubscriptionsForUser,
} from '../services/push.queries.js';
import { sendToSubscriptions } from '../alerts/sender.js';

export function pushRouter(deps: RouteDeps): Router {
  const router = Router();

  router.get('/push/vapid-public-key', (_req, res) => {
    const body: VapidKeyResponse = { publicKey: deps.config.vapidPublicKey };
    sendJson(res, 200, vapidKeyResponseSchema, body, deps.config, 'public, max-age=86400');
  });

  router.post('/push/subscriptions', requireAuth, async (req, res) => {
    const userId = req.session.userId as string;
    const body = parseBody(pushSubscribeRequestSchema, req.body);

    const result = await upsertSubscription(deps.pool, {
      userId,
      endpoint: body.endpoint,
      p256dh: body.keys.p256dh,
      auth: body.keys.auth,
      userAgent: body.user_agent ?? null,
    });

    const resBody: PushSubscribeResponse = { id: result.id };
    sendJson(
      res,
      result.inserted ? 201 : 200,
      pushSubscribeResponseSchema,
      resBody,
      deps.config,
      'no-store',
    );
  });

  router.delete('/push/subscriptions', requireAuth, async (req, res) => {
    const userId = req.session.userId as string;
    const body = parseBody(pushUnsubscribeRequestSchema, req.body);
    await deleteSubscriptionByEndpointForUser(deps.pool, userId, body.endpoint);
    res.status(204).end();
  });

  router.post('/push/test', requireAuth, async (req, res) => {
    const userId = req.session.userId as string;
    const subscriptions = await listSubscriptionsForUser(deps.pool, userId);
    const sent = await sendToSubscriptions(
      deps.pool,
      subscriptions,
      {
        title: 'DockCast test notification',
        body: 'Push notifications are working.',
        url: '/',
        tag: 'test',
      },
      deps.pushTransport,
      deps.now(),
    );
    const resBody: PushTestResponse = { sent };
    sendJson(res, 202, pushTestResponseSchema, resBody, deps.config, 'no-store');
  });

  return router;
}
