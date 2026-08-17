/**
 * Map legend: title, ramp swatches, "Updated X · N stations" footer, and the
 * "Live data only" fallback for cities without forecasting. ui-spec.md §4.1.
 */
import { Icon } from '../ui/Icon.js';
import { LegendProb } from '../forecast/LegendProb.js';
import { COPY } from '../../lib/constants.js';
import { readoutFor } from '../forecast/HorizonSlider.js';
import { fmtRelative } from '../../lib/time.js';
import type { Target } from '../../lib/prob.js';

export interface MapLegendProps {
  target: Target;
  horizonIndex: number;
  now: Date;
  asOf: Date;
  stationCount: number;
  forecastingEnabled: boolean;
  cityName: string;
}

export function MapLegend({
  target,
  horizonIndex,
  now,
  asOf,
  stationCount,
  forecastingEnabled,
  cityName,
}: MapLegendProps) {
  if (!forecastingEnabled) {
    return (
      <div className="flex flex-col gap-3 rounded-[var(--r-2)] bg-surface p-4" style={{ boxShadow: 'var(--shadow-panel)' }}>
        <p className="wash-warn flex items-center gap-2 rounded-[var(--r-1)] px-3 py-2 text-[length:var(--fs-sm)] text-ink">
          <Icon name="alert" size={16} />
          {COPY.map.liveOnlyBanner(cityName)}
        </p>
        <p className="text-[length:var(--fs-sm)] font-medium text-ink">{COPY.map.legendLive}</p>
        <ul className="flex flex-col gap-1.5 text-[length:var(--fs-sm)] text-ink-2">
          <li className="flex items-center gap-2">
            <span aria-hidden="true" className="inline-block h-3 w-3 rounded-full" style={{ background: 'var(--p4)' }} />
            {COPY.map.legendLiveHas(target === 'bikes' ? 'bike' : 'dock')}
          </li>
          <li className="flex items-center gap-2">
            <span aria-hidden="true" className="inline-block h-3 w-3 rounded-full" style={{ background: 'var(--p0)' }} />
            {COPY.map.legendLiveEmpty}
          </li>
        </ul>
      </div>
    );
  }

  const readout = readoutFor(horizonIndex);
  const when = horizonIndex === 0 ? 'now' : readout.toLowerCase().replace(/^in /, 'in ');
  const title =
    target === 'bikes' ? COPY.map.legendTitle.bikes(when) : COPY.map.legendTitle.docks(when);

  return (
    <div
      className="flex flex-col gap-3 rounded-[var(--r-2)] bg-surface p-4"
      style={{ boxShadow: 'var(--shadow-panel)' }}
    >
      <p className="text-[length:var(--fs-sm)] font-medium text-ink">{title}</p>
      <LegendProb />
      <p className="text-[length:var(--fs-xs)] text-ink-3">
        {COPY.map.updated(fmtRelative(asOf, now), stationCount)}
      </p>
    </div>
  );
}
