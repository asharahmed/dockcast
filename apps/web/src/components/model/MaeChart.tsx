/**
 * Expected-count error (MAE) by horizon. ui-spec.md §4.5 `MaeChart`.
 * Tiers `gbm_active`/`bd_cal`/`persistence` (no shadow); always
 * `target: 'cnt'` — unaffected by the page's bikes/docks toggle.
 */
import {
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { ChartLegend } from '../ui/ChartLegend.js';
import { ChartTable, useChartTableToggle } from '../ui/ChartTable.js';
import { Button } from '../ui/Button.js';
import { EmptyState } from '../ui/EmptyState.js';
import { MetricTooltip } from './MetricTooltip.js';
import { fmtDayShort, horizonDurationLabel } from '../../lib/time.js';
import { COPY, HORIZONS } from '../../lib/constants.js';
import { filterMetrics, staleDay, tiersPresent, pivotByHorizon, TIER_TOKEN, TIER_DASHED } from '../../lib/modelMetrics.js';
import type { ModelMetricRow, MetricsSlice } from '../../api/types.js';

const CHART_HEIGHT = 240 + 36;

export interface MaeChartProps {
  metrics: ModelMetricRow[];
  slice: MetricsSlice;
}

export function MaeChart({ metrics, slice }: MaeChartProps) {
  const [showTable, toggleTable] = useChartTableToggle();
  const rows = filterMetrics(metrics, { windowDays: 7, metric: 'mae', target: 'cnt', slice }).filter(
    (r) => r.horizon !== 0,
  );
  const tiers = tiersPresent(rows).filter((t) => t !== 'gbm_shadow');
  const asOf = staleDay(metrics, rows);

  if (rows.length === 0) {
    return <EmptyState icon="clock" title={COPY.model.charts.empty} />;
  }

  const data = pivotByHorizon(rows, HORIZONS);

  return (
    <div className="dc-chart flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h3 className="text-[length:var(--fs-md)] font-medium">
          {COPY.model.charts.maeTitle}
          {asOf !== null && (
            <span className="ml-1 font-normal text-[length:var(--fs-sm)] text-ink-2">
              · {COPY.model.charts.asOf(fmtDayShort(asOf))}
            </span>
          )}
        </h3>
        <Button type="button" variant="ghost" onClick={toggleTable}>
          {showTable ? COPY.station.chart.chartToggle : COPY.station.chart.table}
        </Button>
      </div>

      <ChartLegend
        items={tiers.map((tier) => ({ label: COPY.model.tierNames[tier], color: TIER_TOKEN[tier] }))}
      />

      {showTable ? (
        <ChartTable
          caption={COPY.model.charts.maeTitle}
          columns={[
            { key: 'horizon', label: 'Horizon', format: (v) => horizonDurationLabel(v as number) },
            ...tiers.map((tier) => ({
              key: tier,
              label: COPY.model.tierNames[tier],
              format: (v: unknown) => (typeof v === 'number' ? v.toFixed(2) : '—'),
            })),
          ]}
          rows={data}
        />
      ) : (
        <div style={{ height: CHART_HEIGHT }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data} margin={{ top: 8, right: 40, left: 0, bottom: 8 }}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="horizon" tickFormatter={(v: number) => horizonDurationLabel(v)} />
              <YAxis domain={[0, 'auto']} tickFormatter={(v: number) => v.toFixed(1)} />
              <Tooltip
                content={(props) => <MetricTooltip {...props} tiers={tiers} />}
                cursor={{ stroke: 'var(--rule-strong)' }}
              />
              {tiers.map((tier) => (
                <Line
                  key={tier}
                  type="monotone"
                  dataKey={tier}
                  name={COPY.model.tierNames[tier]}
                  stroke={TIER_TOKEN[tier]}
                  strokeWidth={2}
                  strokeDasharray={TIER_DASHED[tier] ? '4 3' : undefined}
                  dot={false}
                  activeDot={{ r: 5, stroke: 'var(--surface)', strokeWidth: 2 }}
                  connectNulls={false}
                />
              ))}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
