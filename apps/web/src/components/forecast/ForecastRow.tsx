/**
 * One horizon row: label + bike/dock ProbBadges. Used by `StationPanel`'s
 * compact 6-row list. ui-spec.md §4.1.
 */
import { ProbBadge } from './ProbBadge.js';

export interface ForecastRowProps {
  horizonLabel: string;
  pBike: number | null;
  pDock: number | null;
}

export function ForecastRow({ horizonLabel, pBike, pDock }: ForecastRowProps) {
  const empty = pBike === null && pDock === null;

  return (
    <div
      className={`flex items-center justify-between gap-3 py-1.5 ${empty ? 'text-ink-3' : ''}`}
    >
      <span className="text-[length:var(--fs-sm)]">{horizonLabel}</span>
      <div className="flex items-center gap-4">
        <ProbBadge p={pBike} size="sm" />
        <ProbBadge p={pDock} size="sm" />
      </div>
    </div>
  );
}
