/**
 * Forecast lookup semantics shared by lookup/trip/commutes/alerts.
 * `docs/api.md` §0.1, `docs/ml-spec.md` §6.
 */
import { z } from 'zod';
import { MAX_LEAD, MIN_LEAD, VERDICT_GOOD, VERDICT_RISKY } from './constants.js';

/** How a leg's probability was produced. `docs/api.md` §3 (`TripLeg.kind`), §6 (`CommuteOutlook`). */
export const legKindSchema = z.enum(['forecast', 'typical', 'unavailable']);
export type LegKind = z.infer<typeof legKindSchema>;

/** Overall trip/commute verdict. `docs/api.md` §0.1, §3, §6. */
export const verdictSchema = z.enum(['good', 'risky', 'bad', 'unknown']);
export type Verdict = z.infer<typeof verdictSchema>;

/** Clamp a lead time (minutes) into `[MIN_LEAD, MAX_LEAD]`. */
export function clampLead(leadMin: number): number {
  return Math.min(MAX_LEAD, Math.max(MIN_LEAD, leadMin));
}

/**
 * Interpolate a value at `lead` minutes from parallel `horizons`/`values`
 * arrays. `docs/api.md` §0.1 rule 3:
 * - `lead > MAX_LEAD` → `null` (caller falls back to "typical").
 * - otherwise `lead` is clamped to `[MIN_LEAD, MAX_LEAD]`.
 * - exact horizon match → that horizon's value.
 * - otherwise linear interpolation between the two bracketing horizons.
 * - if either bracketing value is `null` → `null`.
 *
 * `horizons` and `values` must be the same length and index-aligned;
 * `horizons` need not be sorted, but ties/duplicates are undefined behaviour.
 */
export function interpolate(
  horizons: readonly number[],
  values: readonly (number | null)[],
  lead: number,
): number | null {
  if (lead > MAX_LEAD) return null;
  const target = clampLead(lead);

  let exactIdx = -1;
  let loIdx = -1;
  let hiIdx = -1;

  for (let i = 0; i < horizons.length; i++) {
    const h = horizons[i];
    if (h === undefined) continue;
    if (h === target) {
      exactIdx = i;
      break;
    }
    if (h < target) {
      const currentLo = loIdx === -1 ? undefined : horizons[loIdx];
      if (currentLo === undefined || h > currentLo) loIdx = i;
    } else if (h > target) {
      const currentHi = hiIdx === -1 ? undefined : horizons[hiIdx];
      if (currentHi === undefined || h < currentHi) hiIdx = i;
    }
  }

  if (exactIdx !== -1) return values[exactIdx] ?? null;
  if (loIdx === -1 || hiIdx === -1) return null;

  const pLo = values[loIdx];
  const pHi = values[hiIdx];
  if (pLo === null || pLo === undefined || pHi === null || pHi === undefined) return null;

  const hLo = horizons[loIdx];
  const hHi = horizons[hiIdx];
  if (hLo === undefined || hHi === undefined) return null;

  return pLo + (pHi - pLo) * ((target - hLo) / (hHi - hLo));
}

/**
 * Trip/commute verdict. `docs/api.md` §0.1: if either leg's kind isn't
 * `'forecast'` → `'unknown'`; otherwise `m = min(p_origin, p_dest)`,
 * `m >= VERDICT_GOOD` → `'good'`, `m >= VERDICT_RISKY` → `'risky'`, else `'bad'`.
 */
export function verdict(
  pOrigin: number | null,
  pDest: number | null,
  originKind: LegKind,
  destKind: LegKind,
): Verdict {
  if (originKind !== 'forecast' || destKind !== 'forecast') return 'unknown';
  if (pOrigin === null || pDest === null) return 'unknown';

  const m = Math.min(pOrigin, pDest);
  if (m >= VERDICT_GOOD) return 'good';
  if (m >= VERDICT_RISKY) return 'risky';
  return 'bad';
}
