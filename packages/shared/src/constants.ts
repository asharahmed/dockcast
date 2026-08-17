/**
 * Cross-cutting constants shared by the Node side (`@dockcast/shared`) and the
 * Python side (`dockcast_ml.timeutil` / `dockcast_ml.horizons`). Both must stay
 * identical — see `docs/architecture.md` §5 ("Horizons") and `docs/api.md` §0.
 *
 * Do not re-declare these values anywhere else (`docs/plan.md` §1 R5).
 */

/** Forecast horizons in minutes, ascending. `docs/ml-spec.md` §0. */
export const HORIZONS = [15, 30, 45, 60, 90, 120] as const;

/** A single element of {@link HORIZONS}. */
export type Horizon = (typeof HORIZONS)[number];

/** Shortest lead time (minutes) the predictor serves; leads below this clamp up. */
export const MIN_LEAD = 15;

/** Longest lead time (minutes) the predictor serves; leads above this are "typical". */
export const MAX_LEAD = 120;

/** Assumed walking speed, metres per minute. `docs/api.md` §0. */
export const WALK_M_PER_MIN = 80;

/** Assumed cycling speed, km/h, for `rideMinutesDefault`. `docs/api.md` §0.1. */
export const RIDE_KMH = 12;

/** Fixed overhead (unlock/lock/walk-to-dock) added to a ride estimate, minutes. */
export const RIDE_OVERHEAD_MIN = 3;

/** Search radius (metres) for "nearby alternative station" lookups. */
export const ALT_RADIUS_M = 600;

/** Probability at/above which an alternative station is highlighted as a "good" bet. */
export const ALT_GOOD_P = 0.9;

/** Minimum `min(p_origin, p_dest)` for a trip verdict of `'good'`. */
export const VERDICT_GOOD = 0.8;

/** Minimum `min(p_origin, p_dest)` for a trip verdict of `'risky'` (below `VERDICT_GOOD`). */
export const VERDICT_RISKY = 0.5;

/**
 * Day-type codes used throughout the model and schema: `WD` = Mon-Fri
 * non-holiday, `SAT` = Saturday, `SUN` = Sunday or an Ontario statutory
 * holiday. `docs/ml-spec.md` §0.
 */
export const DAY_TYPE = { WD: 0, SAT: 1, SUN: 2 } as const;

/** A single value of {@link DAY_TYPE}. */
export type DayType = (typeof DAY_TYPE)[keyof typeof DAY_TYPE];

/**
 * Version of the GBM feature manifest (`docs/ml-spec.md` §3.2). Any change to
 * the feature list/order bumps this and forces retraining.
 */
export const FEATURE_SCHEMA_VERSION = 1;
