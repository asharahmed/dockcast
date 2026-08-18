/**
 * Theme preference persistence. ui-spec.md §1 `lib/theme.ts`, §2.1.
 * `index.html`'s inline bootstrap script reads the same key before paint.
 *
 * Consumers subscribe via `subscribeTheme` (used by `hooks/useTheme.ts` through
 * `useSyncExternalStore`) so that every mounted component — e.g. the map's
 * basemap style swap — reacts to a change made anywhere (footer toggle, another
 * tab via the `storage` event).
 */

export type ThemePreference = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'dockcast.theme';
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

/** Current stored preference; `'system'` if unset or storage is unavailable. */
export function getTheme(): ThemePreference {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
  } catch {
    /* localStorage unavailable (private browsing) — fall back to system */
  }
  return 'system';
}

/** Persist `theme`, apply it to `<html data-theme>` immediately, and notify subscribers. */
export function setTheme(theme: ThemePreference): void {
  if (theme === 'system') {
    delete document.documentElement.dataset.theme;
  } else {
    document.documentElement.dataset.theme = theme;
  }
  try {
    if (theme === 'system') localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    /* localStorage unavailable — DOM attribute above still applies for this session */
  }
  notify();
}

/** Subscribe to theme changes (this tab and other tabs). Returns an unsubscribe function. */
export function subscribeTheme(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent): void => {
    if (event.key === null || event.key === STORAGE_KEY) listener();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}
