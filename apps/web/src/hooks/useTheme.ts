/**
 * Reactive wrapper around `lib/theme.ts`. ui-spec.md §1 `hooks/useTheme.ts`.
 * Backed by `useSyncExternalStore` so all consumers (footer toggle, map basemap)
 * stay in sync when the preference changes anywhere.
 */
import { useCallback, useSyncExternalStore } from 'react';
import { getTheme, setTheme, subscribeTheme, type ThemePreference } from '../lib/theme.js';

const getServerSnapshot = (): ThemePreference => 'system';

export function useTheme(): [ThemePreference, (theme: ThemePreference) => void] {
  const theme = useSyncExternalStore(subscribeTheme, getTheme, getServerSnapshot);
  const update = useCallback((next: ThemePreference) => {
    setTheme(next);
  }, []);
  return [theme, update];
}
