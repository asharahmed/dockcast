/**
 * Shared tooltip for `BrierChart`/`MaeChart`: `"<horizon>: gbm 0.062 (n
 * 12,340) · flow 0.081 · persistence 0.104"`. ui-spec.md §4.5.
 */
import type { TooltipContentProps } from 'recharts';
import { horizonDurationLabel } from '../../lib/time.js';
import { COPY } from '../../lib/constants.js';
import type { MetricsTier } from '../../api/types.js';

export function MetricTooltip({
  active,
  payload,
  label,
  tiers,
}: TooltipContentProps & { tiers: MetricsTier[] }) {
  if (!active || !payload || payload.length === 0 || typeof label !== 'number') return null;
  const point = payload[0]?.payload as Record<string, number | null> | undefined;
  if (!point) return null;

  const parts = tiers
    .map((tier) => {
      const value = point[tier];
      const n = point[`${tier}__n`];
      if (typeof value !== 'number') return null;
      const valueText = value.toFixed(3);
      return typeof n === 'number'
        ? `${COPY.model.tierNames[tier]} ${valueText} (${COPY.model.charts.nSuffix(n)})`
        : `${COPY.model.tierNames[tier]} ${valueText}`;
    })
    .filter((s): s is string => s !== null);

  return (
    <div
      className="rounded-[var(--r-1)] border border-rule bg-surface px-3 py-2 text-[length:var(--fs-xs)] text-ink"
      style={{ boxShadow: 'var(--shadow-panel)' }}
    >
      <p className="font-medium">{`${horizonDurationLabel(label)}: ${parts.join(' · ')}`}</p>
    </div>
  );
}
