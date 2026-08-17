/**
 * `docs/api.md` §0.1 `verdict(p_origin, p_dest)`. Thin adapter over the
 * shared `verdict()` (`@dockcast/shared/forecast.ts`), which already
 * implements the rule (`docs/plan.md` §1 R5: don't re-declare it).
 */
import { verdict as sharedVerdict, type LegKind, type Verdict } from '@dockcast/shared';

export function computeVerdict(
  origin: { kind: LegKind; p: number | null },
  dest: { kind: LegKind; p: number | null },
): Verdict {
  return sharedVerdict(origin.p, dest.p, origin.kind, dest.kind);
}
