/**
 * Live clock, refreshed every `intervalMs` (default 30 s). ui-spec.md §5:
 * "refresh every 30 s via a shared `useNow(30_000)` hook."
 *
 * SPEC-GAP: not listed in the `hooks/` file table (ui-spec.md §1), but §5
 * names it explicitly by this signature — added here as the one place a
 * live `Date` is read, so every consumer downstream (`fmtRelative`,
 * `HorizonSlider`'s `now` prop) stays injectable per plan.md §1 R9.
 */
import { useEffect, useState } from 'react';

export function useNow(intervalMs = 30_000): Date {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);

  return now;
}
