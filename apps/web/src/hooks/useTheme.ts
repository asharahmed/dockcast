/**
 * Reactive wrapper around `lib/theme.ts`. ui-spec.md §1 `hooks/useTheme.ts`.
 */
import { useCallback, useState } from 'react';
import { getTheme, setTheme, type ThemePreference } from '../lib/theme.js';

export function useTheme(): [ThemePreference, (theme: ThemePreference) => void] {
  const [theme, setThemeState] = useState<ThemePreference>(() => getTheme());

  const update = useCallback((next: ThemePreference) => {
    setTheme(next);
    setThemeState(next);
  }, []);

  return [theme, update];
}
