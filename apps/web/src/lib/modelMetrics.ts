/**
 * `ModelResponse.metrics` filter/pivot helpers shared by the `/model` charts
 * (ui-spec.md §4.5 `BrierChart`/`MaeChart`/`ReliabilityChart`). Not itself a
 * named file in ui-spec.md's file tree — kept here rather than duplicated in
 * each chart component.
 */
import type { ModelMetricRow, MetricsTier, MetricsTarget, MetricsSlice, MetricName } from '../api/types.js';

export interface MetricFilter {
  windowDays: 1 | 7;
  metric: MetricName;
  target: MetricsTarget;
  slice: MetricsSlice;
}

export function filterMetrics(rows: ModelMetricRow[], opts: MetricFilter): ModelMetricRow[] {
  return rows.filter(
    (r) =>
      r.window_days === opts.windowDays &&
      r.metric === opts.metric &&
      r.target === opts.target &&
      r.slice === opts.slice,
  );
}

/**
 * Fixed slot order for chart series (ui-spec.md §2.2 chart series tokens,
 * §4.5: "series in fixed order/tokens... missing tiers simply absent (never
 * re-coloured)").
 */
export const TIER_ORDER: MetricsTier[] = ['gbm_active', 'bd_cal', 'persistence', 'gbm_shadow'];

export function tiersPresent(rows: ModelMetricRow[]): MetricsTier[] {
  const present = new Set(rows.map((r) => r.tier));
  return TIER_ORDER.filter((t) => present.has(t));
}

export const TIER_TOKEN: Record<MetricsTier, string> = {
  gbm_active: 'var(--s1)',
  bd_cal: 'var(--s2)',
  persistence: 'var(--s3)',
  bd_raw: 'var(--s2)',
  gbm_shadow: 'var(--s1-lite)',
};

/** Only `gbm_shadow` is dashed (ui-spec.md §2.2: "not a 4th hue: shadow is a *state* of gbm"). */
export const TIER_DASHED: Record<MetricsTier, boolean> = {
  gbm_active: false,
  bd_cal: false,
  persistence: false,
  bd_raw: false,
  gbm_shadow: true,
};

/** One row per horizon, one column per tier present (plus a `<tier>__n` companion column for tooltip sample sizes). */
export function pivotByHorizon(
  rows: ModelMetricRow[],
  horizons: readonly number[],
): Record<string, number | null>[] {
  return horizons.map((h) => {
    const point: Record<string, number | null> = { horizon: h };
    for (const row of rows) {
      if (row.horizon === h) {
        point[row.tier] = row.value;
        point[`${row.tier}__n`] = row.n;
      }
    }
    return point;
  });
}

export interface ReliabilityPoint {
  mean_pred: number;
  frac_pos: number;
  n: number;
}

/** Assembles the 10 reliability bins for one tier from the `rel_bin_<b>_*` metric rows. */
export function buildReliabilitySeries(rows: ModelMetricRow[], tier: MetricsTier): ReliabilityPoint[] {
  const points: ReliabilityPoint[] = [];
  for (let bin = 0; bin <= 9; bin++) {
    const meanRow = rows.find((r) => r.tier === tier && r.metric === `rel_bin_${bin}_mean_pred`);
    const fracRow = rows.find((r) => r.tier === tier && r.metric === `rel_bin_${bin}_frac_pos`);
    const nRow = rows.find((r) => r.tier === tier && r.metric === `rel_bin_${bin}_n`);
    if (meanRow?.value != null && fracRow?.value != null) {
      points.push({ mean_pred: meanRow.value, frac_pos: fracRow.value, n: nRow?.value ?? 0 });
    }
  }
  return points.sort((a, b) => a.mean_pred - b.mean_pred);
}
