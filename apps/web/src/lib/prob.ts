/**
 * Probability display helpers. ui-spec.md §2.2 (ramp), §5 (`fmtPct`), §11.
 */
import { verdict } from '@dockcast/shared';
import type { MapStation } from '../api/types.js';

/** Bikes-vs-docks selection, shared by `TargetToggle`, the map and station page. */
export type Target = 'bikes' | 'docks';

/** Ordinal step for the probability ramp, `-1` (no forecast) through `4`. */
export type ProbStep = -1 | 0 | 1 | 2 | 3 | 4;

/**
 * Map a probability to its ramp step. ui-spec.md §2.2:
 * `p < .50` → 0, `.50 ≤ p < .70` → 1, `.70 ≤ p < .85` → 2, `.85 ≤ p < .95` → 3,
 * `p ≥ .95` → 4; `null` → -1 (unavailable / not fresh).
 */
export function probStep(p: number | null): ProbStep {
  if (p === null) return -1;
  if (p >= 0.95) return 4;
  if (p >= 0.85) return 3;
  if (p >= 0.7) return 2;
  if (p >= 0.5) return 1;
  return 0;
}

/**
 * Legend/step labels, ui-spec.md §2.2. Index by {@link ProbStep} (0..4 only —
 * typed as a plain array, not a 5-tuple, so a `-1` step can be indexed and
 * fall through to `undefined` under `noUncheckedIndexedAccess` rather than
 * being a compile error).
 */
export const STEP_LABELS: readonly string[] = [
  'Unlikely',
  'Coin flip',
  'Likely',
  'Very likely',
  'Near certain',
];

/** Human range for a ramp step, ui-spec.md §4.1 `MapLegend`. */
export const STEP_RANGES: readonly string[] = ['<50%', '50–70%', '70–85%', '85–95%', '≥95%'];

/**
 * Format a probability as a whole-number percentage.
 * ui-spec.md §5: `Math.round(p*100) + '%'` (0.995 → "100%", 0.004 → "0%").
 */
export function fmtPct(p: number): string {
  return `${Math.round(p * 100)}%`;
}

/** Re-export of `@dockcast/shared`'s `verdict` for display-only call sites (ui-spec.md §1 `lib/prob.ts`). */
export const verdictOf = verdict;

/**
 * Probability + expected count for a map station at a horizon-slider index.
 * ui-spec.md §4.1 "Semantics": index 0 ("now") is the fresh live has-bike/
 * has-dock signal (`p ∈ {0,1}`, `-1` if not fresh); index ≥1 reads the
 * `MapStation.f` forecast tuple for horizon `index - 1` (`-1` if that
 * horizon has no forecast). `p = -1` is the same "no forecast" sentinel as
 * {@link probStep}'s `null` case.
 */
export function mapProbAt(
  station: MapStation,
  target: Target,
  horizonIndex: number,
): { p: number; exp: number | null } {
  if (horizonIndex === 0) {
    if (!station.fresh) return { p: -1, exp: null };
    const has = target === 'bikes' ? station.b >= 1 : station.d >= 1;
    return { p: has ? 1 : 0, exp: null };
  }
  const entry = station.f[horizonIndex - 1];
  if (!entry) return { p: -1, exp: null };
  const [pBike, pDock, exp] = entry;
  return { p: target === 'bikes' ? pBike : pDock, exp };
}
