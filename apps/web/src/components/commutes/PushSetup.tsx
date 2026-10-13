/**
 * Device push-alert enrolment strip: unsupported/denied/default/subscribed.
 * ui-spec.md §4.4 `PushSetup`.
 */
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Icon } from '../ui/Icon.js';
import { Button } from '../ui/Button.js';
import {
  pushSupportState,
  currentSubscription,
  subscribeToPush,
  unsubscribe,
} from '../../lib/push.js';
import { useVapidKey, useSubscribePush, useUnsubscribePush, useTestPush } from '../../api/queries.js';
import { useToast } from '../shell/Toasts.js';
import { COPY } from '../../lib/constants.js';
import { isIOS, isStandalone } from '../../lib/install.js';

type UiState = 'checking' | 'unsupported' | 'denied' | 'default' | 'subscribed';

export function PushSetup() {
  const [state, setState] = useState<UiState>('checking');
  const vapidQuery = useVapidKey();
  const subscribeMutation = useSubscribePush();
  const unsubscribeMutation = useUnsubscribePush();
  const testMutation = useTestPush();
  const addToast = useToast();

  const refresh = useCallback(async () => {
    const base = pushSupportState();
    if (base !== 'default') {
      setState(base);
      return;
    }
    try {
      const sub = await currentSubscription();
      setState(sub ? 'subscribed' : 'default');
    } catch {
      setState('default');
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function onEnable() {
    const vapidKey = vapidQuery.data?.publicKey ?? (await vapidQuery.refetch()).data?.publicKey;
    if (!vapidKey) {
      addToast(COPY.commutes.push.enableErrorToast, 'critical');
      return;
    }
    try {
      const sub = await subscribeToPush(vapidKey);
      const json = sub.toJSON();
      await subscribeMutation.mutateAsync({
        endpoint: sub.endpoint,
        keys: { p256dh: json.keys?.p256dh ?? '', auth: json.keys?.auth ?? '' },
        user_agent: navigator.userAgent,
      });
      setState('subscribed');
      addToast(COPY.commutes.push.enabledToast, 'good');
    } catch {
      addToast(COPY.commutes.push.enableErrorToast, 'critical');
      await refresh();
    }
  }

  async function onTest() {
    try {
      const result = await testMutation.mutateAsync();
      addToast(
        result.sent > 0 ? COPY.commutes.push.testSentToast : COPY.commutes.push.testNoneToast,
        result.sent > 0 ? 'good' : 'neutral',
      );
    } catch {
      addToast(COPY.errors.generic, 'critical');
    }
  }

  async function onDisable() {
    const sub = await currentSubscription();
    if (sub) {
      await unsubscribeMutation.mutateAsync({ endpoint: sub.endpoint });
      await unsubscribe();
    }
    setState('default');
  }

  if (state === 'checking') return null;

  return (
    <div className="flex flex-col gap-3 rounded-[var(--r-2)] border border-rule bg-surface p-[var(--sp-4)]">
      {state === 'unsupported' &&
        // iOS Safari has no PushManager until DockCast runs as a Home Screen app.
        (isIOS() && !isStandalone() ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="flex items-center gap-2 text-[length:var(--fs-sm)] text-ink-2">
              <Icon name="bell-off" size={18} />
              {COPY.pwa.iosPushHint}
            </p>
            <Link
              to="/about#install"
              className="inline-flex min-h-11 items-center text-[length:var(--fs-sm)] font-medium text-signal underline underline-offset-4"
            >
              {COPY.pwa.iosPushHowTo}
            </Link>
          </div>
        ) : (
          <p className="flex items-center gap-2 text-[length:var(--fs-sm)] text-ink-2">
            <Icon name="bell-off" size={18} />
            {COPY.commutes.push.unsupported}
          </p>
        ))}

      {state === 'denied' && (
        <p className="flex items-center gap-2 text-[length:var(--fs-sm)] text-ink-2">
          <Icon name="bell-off" size={18} />
          {COPY.commutes.push.denied}
        </p>
      )}

      {state === 'default' && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="flex items-center gap-2 text-[length:var(--fs-sm)] text-ink">
            <Icon name="bell" size={18} />
            {COPY.commutes.push.defaultBody}
          </p>
          <Button type="button" onClick={onEnable}>
            {COPY.commutes.push.enable}
          </Button>
        </div>
      )}

      {state === 'subscribed' && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="flex items-center gap-2 text-[length:var(--fs-sm)] text-ink">
            <Icon name="bell" size={18} />
            {COPY.commutes.push.subscribedBody}
          </p>
          <div className="flex items-center gap-4">
            <Button type="button" variant="ghost" onClick={onTest}>
              {COPY.commutes.push.sendTest}
            </Button>
            <button
              type="button"
              onClick={onDisable}
              className="text-[length:var(--fs-sm)] text-signal underline underline-offset-4"
            >
              {COPY.commutes.push.turnOff}
            </button>
          </div>
        </div>
      )}

      <p className="text-[length:var(--fs-xs)] text-ink-3">{COPY.commutes.push.note}</p>
    </div>
  );
}
