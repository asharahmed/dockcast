/**
 * 24 h actual + forecast expected + q10-q90 band + capacity line.
 * ui-spec.md §2.5, §4.2 `StationChart`.
 */
import { useMemo } from 'react';
import {
  ComposedChart,
  Line,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  ReferenceLine,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import type { TooltipContentProps } from 'recharts';
import { EmptyState } from '../ui/EmptyState.js';
import { ChartTable, useChartTableToggle } from '../ui/ChartTable.js';
import { ChartLegend } from '../ui/ChartLegend.js';
import { Button } from '../ui/Button.js';
import { COPY } from '../../lib/constants.js';
import { fmtLocalTime } from '../../lib/time.js';
import type { StationHistoryPoint, StationForecastRow, StationCurrent } from '../../api/types.js';

const CHART_HEIGHT = 280 + 36;
const GAP_THRESHOLD_MS = 10 * 60_000;

interface ChartPoint {
  ts: number;
  bikes: number | null;
  expected: number | null;
  range: [number, number] | null;
}

function buildData(
  history: StationHistoryPoint[],
  forecasts: StationForecastRow[],
  current: StationCurrent | null,
  now: Date,
): ChartPoint[] {
  const sorted = [...history].sort(
    (a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime(),
  );

  const points: ChartPoint[] = [];
  let prevTs: number | null = null;
  for (const point of sorted) {
    const ts = new Date(point.ts).getTime();
    if (prevTs !== null && ts - prevTs > GAP_THRESHOLD_MS) {
      // connectNulls={false}: an explicit null breaks the line across the gap.
      points.push({ ts: prevTs + 1, bikes: null, expected: null, range: null });
    }
    points.push({ ts, bikes: point.bikes, expected: null, range: null });
    prevTs = ts;
  }

  if (current) {
    points.push({ ts: now.getTime(), bikes: null, expected: current.bikes, range: null });
  }

  for (const row of forecasts) {
    points.push({
      ts: new Date(row.valid_at).getTime(),
      bikes: null,
      expected: row.exp_bikes,
      range: row.q10 !== null && row.q90 !== null ? [row.q10, row.q90] : null,
    });
  }

  return points.sort((a, b) => a.ts - b.ts);
}

function ChartTooltip({
  active,
  payload,
  label,
  cityTz,
}: TooltipContentProps & { cityTz: string }) {
  if (!active || !payload || payload.length === 0 || typeof label !== 'number') return null;
  const bikesValue = payload.find((p) => p.dataKey === 'bikes')?.value;
  const expectedValue = payload.find((p) => p.dataKey === 'expected')?.value;
  const rangeValue = payload.find((p) => p.dataKey === 'range')?.value;
  const bikes = typeof bikesValue === 'number' ? bikesValue : undefined;
  const expected = typeof expectedValue === 'number' ? expectedValue : undefined;
  const range = Array.isArray(rangeValue) ? (rangeValue as [number, number]) : undefined;

  return (
    <div
      className="rounded-[var(--r-1)] border border-rule bg-surface px-3 py-2 text-[length:var(--fs-xs)] text-ink"
      style={{ boxShadow: 'var(--shadow-panel)' }}
    >
      <p className="font-medium">{fmtLocalTime(new Date(label), cityTz)}</p>
      {typeof bikes === 'number' && <p>{COPY.station.chart.tooltipActual(bikes)}</p>}
      {typeof expected === 'number' && (
        <p>
          {COPY.station.chart.tooltipForecast(
            Math.round(expected),
            range ? Math.round(range[0]) : Math.round(expected),
            range ? Math.round(range[1]) : Math.round(expected),
          )}
        </p>
      )}
    </div>
  );
}

export interface StationChartProps {
  history: StationHistoryPoint[];
  forecasts: StationForecastRow[];
  current: StationCurrent | null;
  capacity: number | null;
  cityTz: string;
  now: Date;
}

export function StationChart({ history, forecasts, current, capacity, cityTz, now }: StationChartProps) {
  const [showTable, toggleTable] = useChartTableToggle();
  const data = useMemo(
    () => buildData(history, forecasts, current, now),
    [history, forecasts, current, now],
  );

  if (history.length === 0) {
    return (
      <div className="dc-chart" data-testid="station-chart" style={{ height: CHART_HEIGHT }}>
        <EmptyState icon="clock" title={COPY.station.chart.empty} />
      </div>
    );
  }

  const maxHistory = history.reduce((max, p) => Math.max(max, p.bikes), 0);
  const yMax = Math.max(capacity ?? 0, current?.cap_eff ?? 0, maxHistory, 1);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h3 className="text-[length:var(--fs-md)] font-medium">Bikes over time</h3>
        <Button variant="ghost" onClick={toggleTable}>
          {showTable ? COPY.station.chart.chartToggle : COPY.station.chart.table}
        </Button>
      </div>

      <ChartLegend
        items={[
          { label: COPY.station.chart.actualLabel, color: 'var(--s1)' },
          { label: COPY.station.chart.forecastLabel, color: 'var(--s2)' },
          { label: COPY.station.chart.bandLabel, color: 'var(--band)', shape: 'swatch' },
        ]}
      />

      {showTable ? (
        <ChartTable
          caption="Bikes over time: actual and forecast"
          columns={[
            { key: 'ts', label: 'Time', format: (v) => fmtLocalTime(new Date(v as number), cityTz) },
            { key: 'bikes', label: 'Actual' },
            { key: 'expected', label: 'Forecast' },
          ]}
          rows={data.map((d) => ({ ts: d.ts, bikes: d.bikes, expected: d.expected }))}
        />
      ) : (
        <div className="dc-chart" data-testid="station-chart" style={{ height: CHART_HEIGHT }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="ts"
                type="number"
                domain={['dataMin', 'dataMax']}
                tickFormatter={(v: number) => fmtLocalTime(new Date(v), cityTz, 'h a')}
                interval="preserveStartEnd"
              />
              <YAxis domain={[0, yMax]} allowDecimals={false} />
              <Tooltip
                content={(props) => <ChartTooltip {...props} cityTz={cityTz} />}
                cursor={{ stroke: 'var(--rule-strong)' }}
              />
              <Area
                dataKey="range"
                name={COPY.station.chart.bandLabel}
                fill="var(--band)"
                stroke="none"
                connectNulls={false}
              />
              <Line
                type="monotone"
                dataKey="bikes"
                name={COPY.station.chart.actualLabel}
                stroke="var(--s1)"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 5, stroke: 'var(--surface)', strokeWidth: 2 }}
                connectNulls={false}
              />
              <Line
                type="monotone"
                dataKey="expected"
                name={COPY.station.chart.forecastLabel}
                stroke="var(--s2)"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 5, stroke: 'var(--surface)', strokeWidth: 2 }}
                connectNulls={false}
              />
              {capacity !== null && (
                <ReferenceLine
                  y={capacity}
                  stroke="var(--ref)"
                  label={{ value: COPY.station.chart.capacityLabel, position: 'right', fill: 'var(--ink-3)', fontSize: 11 }}
                />
              )}
              <ReferenceLine
                x={now.getTime()}
                stroke="var(--rule-strong)"
                label={{ value: COPY.station.chart.nowLabel, position: 'top', fill: 'var(--ink-3)', fontSize: 11 }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
