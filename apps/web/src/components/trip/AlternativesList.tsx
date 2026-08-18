/**
 * "Nearby with better odds" list. Collapsed behind a text button unless the
 * leg is worth surfacing alternatives for. ui-spec.md §4.1 `TripResult`.
 */
import { useState } from 'react';
import { Link } from 'react-router';
import { ProbBadge } from '../forecast/ProbBadge.js';
import { Icon } from '../ui/Icon.js';
import { COPY, ALT_GOOD_P } from '../../lib/constants.js';
import type { TripAlternative } from '../../api/types.js';

export interface AlternativesListProps {
  alternatives: TripAlternative[];
  target: 'bike' | 'dock';
  /** `true` when the leg's `kind !== 'forecast'` or `p < ALT_GOOD_P` (ui-spec.md §4.1). */
  forceExpanded: boolean;
}

export function AlternativesList({ alternatives, target, forceExpanded }: AlternativesListProps) {
  const [revealed, setRevealed] = useState(false);
  const expanded = forceExpanded || revealed;
  const heading =
    target === 'bike' ? COPY.trip.alternatives.heading.origin : COPY.trip.alternatives.heading.dest;

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setRevealed(true)}
        className="text-left text-[length:var(--fs-sm)] font-medium text-signal underline underline-offset-4"
      >
        {COPY.trip.alternatives.toggle}
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <h4 className="text-[length:var(--fs-sm)] font-medium text-ink">{heading}</h4>
      {alternatives.length === 0 ? (
        <p className="text-[length:var(--fs-sm)] text-ink-2">{COPY.trip.alternatives.empty}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-rule">
          {alternatives.map((alt) => {
            const safeBet = alt.p !== null && alt.p >= ALT_GOOD_P;
            return (
              <li key={alt.station.id} className="flex items-center justify-between gap-3 py-2">
                <div className="flex items-center gap-2">
                  {safeBet && <Icon name="check" size={14} className="shrink-0 text-st-good" />}
                  <div>
                    <Link
                      to={`/station/${alt.station.id}`}
                      className="text-[length:var(--fs-sm)] text-signal underline underline-offset-4"
                    >
                      {alt.station.name}
                    </Link>
                    <p className="text-[length:var(--fs-xs)] text-ink-3">
                      {COPY.trip.alternatives.walkLine(alt.walk_minutes, Math.round(alt.distance_m))}
                      {safeBet && ` · ${COPY.trip.alternatives.safeBet}`}
                    </p>
                  </div>
                </div>
                <ProbBadge p={alt.p} size="sm" />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
