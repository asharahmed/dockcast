/**
 * Geo display helpers. ui-spec.md §1 `lib/geo.ts` ("mirrors api.md constants").
 * `haversineKm`/`rideMinutesDefault` are `@dockcast/shared`'s (plan.md §1 R5:
 * never re-declared); `walkMinutes` is web-only display logic (`docs/api.md`
 * §0.1: `walk_minutes = ceil(distance_m / WALK_M_PER_MIN)`).
 */
import { haversineKm, rideMinutesDefault, WALK_M_PER_MIN } from '@dockcast/shared';

export { haversineKm, rideMinutesDefault };

/** Walking time in whole minutes for a distance in metres. `docs/api.md` §0.1. */
export function walkMinutes(distanceM: number): number {
  return Math.ceil(distanceM / WALK_M_PER_MIN);
}
