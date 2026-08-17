/**
 * Theme preference persistence. ui-spec.md §1 `lib/theme.ts`, §2.1.
 * `index.html`'s inline bootstrap script reads the same key before paint.
 */

export type ThemePreference = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'dockcast.theme';

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

/** Persist `theme` and apply it to `<html data-theme>` immediately. */
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
}
