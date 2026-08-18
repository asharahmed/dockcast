/**
 * Calibration / reliability diagram (predicted vs. observed frequency).
 * ui-spec.md §4.5 `ReliabilityChart`.
 */
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  ReferenceLine,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import type { TooltipContentProps } from 'recharts';
import { ChartLegend } from '../ui/ChartLegend.js';
import { ChartTable, useChartTableToggle } from '../ui/ChartTable.js';
import { Button } from '../ui/Button.js';
import { EmptyState } from '../ui/EmptyState.js';
import { COPY } from '../../lib/constants.js';
import {
  filterMetrics,
  tiersPresent,
  buildReliabilitySeries,
  TIER_TOKEN,
  TIER_DASHED,
} from '../../lib/modelMetrics.js';
import type { ModelMetricRow, MetricsTarget, MetricsSlice, MetricsTier } from '../../api/types.js';

const CHART_HEIGHT = 260 + 36;

function ReliabilityTooltip({
  active,
  payload,
}: TooltipContentProps & { tiers: MetricsTier[] }) {
  if (!active || !payload || payload.length === 0) return null;
  const point = payload[0]?.payload as { mean_pred: number; frac_pos: number; n: number } | undefined;
  if (!point) return null;
  return (
    <div
      className="rounded-[var(--r-1)] border border-rule bg-surface px-3 py-2 text-[length:var(--fs-xs)] text-ink"
      style={{ boxShadow: 'var(--shadow-panel)' }}
    >
      {COPY.model.charts.reliabilityTooltip(
        `${Math.round(point.mean_pred * 100)}%`,
        `${Math.round(point.frac_pos * 100)}%`,
        point.n,
      )}
    </div>
  );
}

export interface ReliabilityChartProps {
  metrics: ModelMetricRow[];
  target: MetricsTarget;
  slice: MetricsSlice;
}

export function ReliabilityChart({ metrics, target, slice }: ReliabilityChartProps) {
  const [showTable, toggleTable] = useChartTableToggle();
  const rows = filterMetrics(metrics, { windowDays: 7, metric: 'brier', target, slice }).filter(
    (r) => r.horizon === 0,
  );
  // Reliability bins share tiers with the pooled Brier rows at horizon 0, but
  // the bin values themselves live under `rel_bin_*` metric names — collect
  // tiers from any horizon-0 row for this target/slice, not just 'brier'.
  const allPooled = metrics.filter(
    (r) => r.window_days === 7 && r.horizon === 0 && r.target === target && r.slice === slice,
  );
  const tiers = tiersPresent(rows.length > 0 ? rows : allPooled);

  const seriesByTier = new Map(tiers.map((tier) => [tier, buildReliabilitySeries(allPooled, tier)]));
  const hasData = [...seriesByTier.values()].some((s) => s.length > 0);

  if (!hasData) {
    return <EmptyState icon="clock" title={COPY.model.charts.empty} />;
  }

  const tableRows = tiers.flatMap((tier) =>
    (seriesByTier.get(tier) ?? []).map((p) => ({
      tier: COPY.model.tierNames[tier],
      mean_pred: p.mean_pred,
      frac_pos: p.frac_pos,
      n: p.n,
    })),
  );

  return (
    <div className="dc-chart flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h3 className="text-[length:var(--fs-md)] font-medium">{COPY.model.charts.reliabilityTitle}</h3>
        <Button type="button" variant="ghost" onClick={toggleTable}>
          {showTable ? COPY.station.chart.chartToggle : COPY.station.chart.table}
        </Button>
      </div>

      <ChartLegend
        items={tiers.map((tier) => ({
          label: COPY.model.tierNames[tier],
          color: TIER_TOKEN[tier],
          dashed: TIER_DASHED[tier],
        }))}
      />

      {showTable ? (
        <ChartTable
          caption={COPY.model.charts.reliabilityTitle}
          columns={[
            { key: 'tier', label: 'Tier' },
            { key: 'mean_pred', label: 'Predicted', format: (v) => `${Math.round((v as number) * 100)}%` },
            { key: 'frac_pos', label: 'Observed', format: (v) => `${Math.round((v as number) * 100)}%` },
            { key: 'n', label: 'n' },
          ]}
          rows={tableRows}
        />
      ) : (
        <div style={{ height: CHART_HEIGHT }}>
          <ResponsiveContainer width="100%" height="100%">
            <ScatterChart margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="mean_pred"
                type="number"
                domain={[0, 1]}
                tickFormatter={(v: number) => `${Math.round(v * 100)}%`}
              />
              <YAxis
                dataKey="frac_pos"
                type="number"
                domain={[0, 1]}
                tickFormatter={(v: number) => `${Math.round(v * 100)}%`}
              />
              <ReferenceLine
                segment={[
                  { x: 0, y: 0 },
                  { x: 1, y: 1 },
                ]}
                stroke="var(--ref)"
                label={{
                  value: COPY.model.charts.perfectLabel,
                  position: 'insideTopLeft',
                  fill: 'var(--ink-3)',
                  fontSize: 11,
                }}
              />
              <Tooltip
                content={(props) => <ReliabilityTooltip {...props} tiers={tiers} />}
                cursor={{ stroke: 'var(--rule-strong)' }}
              />
              {tiers.map((tier) => (
                <Scatter
                  key={tier}
                  name={COPY.model.tierNames[tier]}
                  data={seriesByTier.get(tier) ?? []}
                  fill={TIER_TOKEN[tier]}
                  line={{ stroke: TIER_TOKEN[tier], strokeWidth: 2 }}
                  shape={(props: { cx?: number; cy?: number }) => (
                    <circle
                      cx={props.cx}
                      cy={props.cy}
                      r={4}
                      fill={TIER_TOKEN[tier]}
                      stroke="var(--surface)"
                      strokeWidth={2}
                    />
                  )}
                />
              ))}
            </ScatterChart>
          </ResponsiveContainer>
        </div>
      )}

      <p className="text-[length:var(--fs-sm)] text-ink-2">{COPY.model.charts.reliabilityExplainer}</p>
    </div>
  );
}
