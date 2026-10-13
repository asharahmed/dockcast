/**
 * "Add to Home Screen" support. Chromium browsers fire `beforeinstallprompt`, which has to
 * be captured early (main.tsx calls `captureInstallPrompt()` before React mounts) and can
 * be replayed once from a user gesture. iOS Safari has no prompt API, so the UI shows the
 * Share → Add to Home Screen steps instead. Web Push on iPhone only works once installed.
 */

/** The non-standard Chromium event; not in lib.dom. */
export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export const INSTALL_STATE_EVENT = 'dockcast:install-state';

let deferred: BeforeInstallPromptEvent | null = null;
let installed = false;

function notify(): void {
  window.dispatchEvent(new CustomEvent(INSTALL_STATE_EVENT));
}

export function captureInstallPrompt(): void {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferred = event as BeforeInstallPromptEvent;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    installed = true;
    notify();
  });
}

export function canPromptInstall(): boolean {
  return deferred !== null;
}

export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  const event = deferred;
  if (!event) return 'unavailable';
  deferred = null;
  await event.prompt();
  const { outcome } = await event.userChoice;
  if (outcome === 'accepted') installed = true;
  notify();
  return outcome;
}

export function isStandalone(): boolean {
  if (installed) return true;
  const iosStandalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return iosStandalone || window.matchMedia('(display-mode: standalone)').matches;
}

/** iPhone/iPad, including iPadOS reporting itself as a Mac. */
export function isIOS(): boolean {
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}
