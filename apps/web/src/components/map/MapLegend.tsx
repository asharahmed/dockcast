/**
 * Map legend: title, ramp swatches, "Updated X · N stations" footer, and the
 * "Live data only" fallback for cities without forecasting. ui-spec.md §4.1.
 *
 * `collapsible` (phones, ui-spec.md §6 "legend chip"): starts as a one-line chip with
 * the title and a five-dot ramp, and expands to the full card on tap, so the legend
 * does not cover half the map.
 */
import { useState } from 'react';
import { Icon } from '../ui/Icon.js';
import { IconButton } from '../ui/IconButton.js';
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
  collapsible?: boolean;
}

const RAMP = ['var(--p0)', 'var(--p1)', 'var(--p2)', 'var(--p3)', 'var(--p4)'];

export function MapLegend({
  target,
  horizonIndex,
  now,
  asOf,
  stationCount,
  forecastingEnabled,
  cityName,
  collapsible = false,
}: MapLegendProps) {
  const [expanded, setExpanded] = useState(false);

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

  if (collapsible && !expanded) {
    return (
      <button
        type="button"
        aria-expanded={false}
        aria-label={`${title}. ${COPY.map.legendShow}`}
        onClick={() => setExpanded(true)}
        className="inline-flex min-h-11 items-center gap-2 rounded-[var(--r-pill)] bg-surface px-3 text-[length:var(--fs-sm)] font-medium text-ink"
        style={{ boxShadow: 'var(--shadow-panel)' }}
      >
        <span aria-hidden="true" className="flex items-center gap-0.5">
          {RAMP.map((color) => (
            <span key={color} className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: color }} />
          ))}
        </span>
        <span>{title}</span>
      </button>
    );
  }

  return (
    <div
      className="flex flex-col gap-3 rounded-[var(--r-2)] bg-surface p-4"
      style={{ boxShadow: 'var(--shadow-panel)' }}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-[length:var(--fs-sm)] font-medium text-ink">{title}</p>
        {collapsible && (
          <IconButton
            icon="close"
            size={18}
            aria-label={COPY.map.legendHide}
            aria-expanded={true}
            onClick={() => setExpanded(false)}
            className="-mr-3 -mt-3"
          />
        )}
      </div>
      <LegendProb />
      <p className="text-[length:var(--fs-xs)] text-ink-3">
        {COPY.map.updated(fmtRelative(asOf, now), stationCount)}
      </p>
    </div>
  );
}
