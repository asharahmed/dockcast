/**
 * Web Push helpers. ui-spec.md §1 `lib/push.ts`, §4.4 `PushSetup` state
 * machine, §8 (`applicationServerKey` conversion).
 */

/**
 * Coarse, synchronous support/permission bucket. Whether an app in the
 * `'default'` bucket is *already* subscribed on this device is an async fact
 * (`PushManager.getSubscription()`) that only the caller can resolve —
 * `PushSetup` composes this with that check to land on the fourth UI state,
 * `'subscribed'` (ui-spec.md §4.4).
 */
export type PushSupport = 'unsupported' | 'denied' | 'default';

export function pushSupportState(): PushSupport {
  if (
    typeof navigator === 'undefined' ||
    !('serviceWorker' in navigator) ||
    typeof window === 'undefined' ||
    !('PushManager' in window) ||
    typeof Notification === 'undefined'
  ) {
    return 'unsupported';
  }
  return Notification.permission === 'denied' ? 'denied' : 'default';
}

/** base64url VAPID key → `Uint8Array`, as required by `PushManager.subscribe`. ui-spec.md §8. */
export function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
  return output;
}

/** The current push subscription for this device, if any. */
export async function currentSubscription(): Promise<PushSubscription | null> {
  const registration = await navigator.serviceWorker.ready;
  return registration.pushManager.getSubscription();
}

/**
 * Request notification permission (if not already decided) and subscribe
 * this device. Throws on denial/failure — `PushSetup` catches and toasts.
 * ui-spec.md §4.4, §8.
 */
export async function subscribeToPush(vapidPublicKey: string): Promise<PushSubscription> {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error('Notification permission not granted');
  }
  const registration = await navigator.serviceWorker.ready;
  return registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapidPublicKey).buffer as ArrayBuffer,
  });
}

/**
 * Unsubscribe this device locally. Returns `false` if there was no active
 * subscription. Callers also `DELETE /push/subscriptions` server-side.
 */
export async function unsubscribe(): Promise<boolean> {
  const sub = await currentSubscription();
  if (!sub) return false;
  return sub.unsubscribe();
}
