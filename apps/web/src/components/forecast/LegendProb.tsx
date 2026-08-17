/**
 * Reusable probability-ramp swatch list (5 steps + hollow "no forecast").
 * ui-spec.md §2.2, §4.1. Used by `MapLegend` and (in WP-10) the model page.
 */
import { STEP_LABELS, STEP_RANGES } from '../../lib/prob.js';
import { COPY } from '../../lib/constants.js';

const STEP_COLOR = ['var(--p0)', 'var(--p1)', 'var(--p2)', 'var(--p3)', 'var(--p4)'];

export interface LegendProbProps {
  showNoForecast?: boolean;
}

export function LegendProb({ showNoForecast = true }: LegendProbProps) {
  return (
    <ul className="flex flex-col gap-1.5">
      {STEP_LABELS.map((label, step) => (
        <li key={label} className="flex items-center gap-2 text-[length:var(--fs-sm)] text-ink-2">
          <span
            aria-hidden="true"
            className="inline-block h-3 w-3 shrink-0 rounded-full"
            style={{ background: STEP_COLOR[step] }}
          />
          <span>{label}</span>
          <span className="text-ink-3">{STEP_RANGES[step]}</span>
        </li>
      ))}
      {showNoForecast && (
        <li className="flex items-center gap-2 text-[length:var(--fs-sm)] text-ink-2">
          <span
            aria-hidden="true"
            className="inline-block h-3 w-3 shrink-0 rounded-full"
            style={{ border: '1.5px solid var(--p-none)' }}
          />
          <span>{COPY.map.legendNoForecast}</span>
        </li>
      )}
    </ul>
  );
}
