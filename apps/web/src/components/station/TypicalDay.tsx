/**
 * ui-spec.md §4.2 `TypicalDay` small multiple.
 */
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { EmptyState } from '../ui/EmptyState.js';
import { ChartLegend } from '../ui/ChartLegend.js';
import { COPY } from '../../lib/constants.js';
import { localParts } from '@dockcast/shared';
import type { StationTypicalRow } from '../../api/types.js';

const CHART_HEIGHT = 120 + 36;

function dayLabel(now: Date, cityTz: string): string {
  const { dow } = localParts(now, cityTz);
  if (dow === 5) return 'Saturday';
  if (dow === 6) return 'Sunday';
  return 'Weekday';
}

function bucketToHourLabel(bucket: number): string {
  const hour = Math.floor((bucket * 15) / 60);
  return `${hour}h`;
}

export interface TypicalDayProps {
  typical: StationTypicalRow[];
  now: Date;
  cityTz: string;
}

export function TypicalDay({ typical, now, cityTz }: TypicalDayProps) {
  const title = COPY.station.typicalTitle(dayLabel(now, cityTz));

  if (typical.length === 0) {
    return (
      <div className="flex flex-col gap-2">
        <h3 className="text-[length:var(--fs-md)] font-medium">{title}</h3>
        <EmptyState icon="clock" title={COPY.station.typicalEmpty} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-[length:var(--fs-md)] font-medium">{title}</h3>
      <p className="text-[length:var(--fs-xs)] text-ink-3">{COPY.station.typicalCaption}</p>
      <ChartLegend
        items={[
          { label: 'P(bike)', color: 'var(--s1)' },
          { label: 'P(dock)', color: 'var(--s2)' },
        ]}
      />
      <div className="dc-chart" style={{ height: CHART_HEIGHT }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={typical} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="bucket"
              type="number"
              domain={[0, 95]}
              ticks={[0, 24, 48, 72]}
              tickFormatter={(v: number) => bucketToHourLabel(v)}
            />
            <YAxis
              domain={[0, 1]}
              ticks={[0, 0.5, 1]}
              tickFormatter={(v: number) => `${Math.round(v * 100)}%`}
            />
            <Tooltip
              formatter={(value) => (typeof value === 'number' ? `${Math.round(value * 100)}%` : value)}
              cursor={{ stroke: 'var(--rule-strong)' }}
            />
            <Line
              type="monotone"
              dataKey="p_bike"
              stroke="var(--s1)"
              strokeWidth={2}
              dot={false}
              connectNulls={false}
            />
            <Line
              type="monotone"
              dataKey="p_dock"
              stroke="var(--s2)"
              strokeWidth={2}
              dot={false}
              connectNulls={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
