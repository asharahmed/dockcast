/**
 * Make `matchMedia` answer as a phone (< 768 px) for one test: `max-width` queries
 * match, `min-width: 768px` does not. Restore with the returned function.
 */
import { vi } from 'vitest';

export function asPhone(): () => void {
  const original = window.matchMedia;
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: /max-width/.test(query),
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
  return () => {
    window.matchMedia = original;
  };
}
