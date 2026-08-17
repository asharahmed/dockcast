/**
 * Selected city slug, synced with `?city=` and persisted to localStorage.
 * ui-spec.md §1 `hooks/useCity.ts`.
 */
import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';

const STORAGE_KEY = 'dockcast.city';

function readStored(): string | undefined {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

function writeStored(slug: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, slug);
  } catch {
    /* localStorage unavailable — URL param still carries the selection */
  }
}

export function useCity(defaultSlug?: string): [string | undefined, (slug: string) => void] {
  const [searchParams, setSearchParams] = useSearchParams();
  const fromUrl = searchParams.get('city') ?? undefined;
  const [slug, setSlugState] = useState<string | undefined>(
    () => fromUrl ?? readStored() ?? defaultSlug,
  );

  useEffect(() => {
    if (fromUrl && fromUrl !== slug) setSlugState(fromUrl);
  }, [fromUrl, slug]);

  const setSlug = useCallback(
    (next: string) => {
      setSlugState(next);
      writeStored(next);
      setSearchParams(
        (prev) => {
          const params = new URLSearchParams(prev);
          params.set('city', next);
          return params;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  return [slug, setSlug];
}
