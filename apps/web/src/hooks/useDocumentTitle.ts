/**
 * Sets `document.title`. ui-spec.md §4 (exact titles per route).
 */
import { useEffect } from 'react';

export function useDocumentTitle(title: string): void {
  useEffect(() => {
    document.title = title;
  }, [title]);
}
