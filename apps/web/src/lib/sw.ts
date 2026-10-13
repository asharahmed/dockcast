/**
 * Service-worker registration and the update hand-off (ui-spec.md §8).
 *
 * A new worker installs in the background and then waits. When one is waiting while an
 * older worker controls the page, `SW_UPDATE_EVENT` fires on `window`; the UI offers a
 * reload, and `applyUpdate()` tells the waiting worker to take over and reloads once it
 * has. Checks for a new build happen at registration, hourly, and whenever the app comes
 * back to the foreground (an installed PWA can stay open for days).
 */
export const SW_UPDATE_EVENT = 'dockcast:sw-update';

const UPDATE_CHECK_MS = 60 * 60 * 1000;
let waitingRegistration: ServiceWorkerRegistration | null = null;

export function updateWaiting(): boolean {
  return waitingRegistration?.waiting != null;
}

function announce(registration: ServiceWorkerRegistration): void {
  waitingRegistration = registration;
  window.dispatchEvent(new CustomEvent(SW_UPDATE_EVENT));
}

export async function registerServiceWorker(): Promise<void> {
  if (!('serviceWorker' in navigator)) return;
  const registration = await navigator.serviceWorker.register('/sw.js');

  if (registration.waiting && navigator.serviceWorker.controller) announce(registration);
  registration.addEventListener('updatefound', () => {
    const incoming = registration.installing;
    incoming?.addEventListener('statechange', () => {
      // No controller means this is the very first install, not an update.
      if (incoming.state === 'installed' && navigator.serviceWorker.controller) announce(registration);
    });
  });

  const check = () => {
    registration.update().catch(() => undefined);
  };
  window.setInterval(check, UPDATE_CHECK_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') check();
  });
}

/** Activates the waiting worker and reloads into the new version. */
export function applyUpdate(): void {
  const waiting = waitingRegistration?.waiting;
  if (!waiting) {
    window.location.reload();
    return;
  }
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloaded) return;
    reloaded = true;
    window.location.reload();
  });
  waiting.postMessage({ type: 'SKIP_WAITING' });
}
