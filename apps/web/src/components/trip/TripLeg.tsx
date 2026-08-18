/**
 * One leg (origin or dest) of a `TripResult`: eyebrow, station link, hero
 * probability line, "now"/"expected then" meta, and alternatives.
 * ui-spec.md §4.1 `TripResult`.
 */
import { Link } from 'react-router';
import { ProbBadge } from '../forecast/ProbBadge.js';
import { Chip } from '../ui/Chip.js';
import { AlternativesList } from './AlternativesList.js';
import { fmtLocalTime } from '../../lib/time.js';
import { COPY, MAX_LEAD, ALT_GOOD_P } from '../../lib/constants.js';
import type { TripLeg as TripLegDto } from '../../api/types.js';

export interface TripLegProps {
  leg: TripLegDto;
  role: 'origin' | 'dest';
  time: Date;
  cityTz: string;
}

function reasonText(reason: string | null): string {
  switch (reason) {
    case 'not_fresh':
      return COPY.station.reason.not_fresh;
    case 'zero_capacity':
      return COPY.station.reason.zero_capacity;
    case 'no_rates':
      return COPY.station.reason.no_rates;
    default:
      return COPY.station.reason.other;
  }
}

export function TripLeg({ leg, role, time, cityTz }: TripLegProps) {
  const eyebrow = role === 'origin' ? COPY.trip.eyebrow.origin : COPY.trip.eyebrow.dest;
  const timeText = fmtLocalTime(time, cityTz);
  const target: 'bike' | 'dock' = role === 'origin' ? 'bike' : 'dock';

  const heroObject =
    role === 'origin' ? COPY.trip.heroObject.origin(timeText) : COPY.trip.heroObject.dest(timeText);

  let objectText: string;
  let badgeKind: 'forecast' | 'typical' | 'unavailable';
  let badgeP: number | null;
  let subLabel: string | null = null;

  if (leg.kind === 'unavailable') {
    objectText = COPY.trip.unavailableLabel;
    badgeKind = 'unavailable';
    badgeP = null;
    subLabel = reasonText(leg.reason);
  } else if (leg.kind === 'typical') {
    objectText = heroObject;
    badgeKind = 'typical';
    badgeP = leg.p;
    subLabel = COPY.trip.typicalLabel(MAX_LEAD);
  } else {
    objectText = heroObject;
    badgeKind = 'forecast';
    badgeP = leg.p;
  }

  const forceExpandedAlternatives = leg.kind !== 'forecast' || leg.p === null || leg.p < ALT_GOOD_P;

  return (
    <div className="flex flex-col gap-3 py-[var(--sp-5)]">
      <p className="text-[length:var(--fs-xs)] font-medium uppercase tracking-[.04em] text-ink-3">
        {eyebrow}
      </p>
      <Link
        to={`/station/${leg.station.id}`}
        className="font-[var(--font-display)] text-[length:var(--fs-lg)] font-semibold text-ink hover:text-signal"
      >
        {leg.station.name}
      </Link>

      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-baseline gap-2">
          <ProbBadge p={badgeP} kind={badgeKind} size="lg" />
          <span className="text-[length:var(--fs-md)] text-ink-2">{objectText}</span>
        </div>
        {subLabel && <p className="text-[length:var(--fs-sm)] text-ink-3">{subLabel}</p>}
      </div>

      {leg.current && (
        <div className="flex flex-wrap items-center gap-2 text-[length:var(--fs-sm)] text-ink-2">
          <span>{COPY.trip.nowMeta(leg.current.bikes, leg.current.docks)}</span>
          {!leg.current.is_fresh && (
            <Chip tone="serious" icon="alert">
              {COPY.trip.notReporting}
            </Chip>
          )}
        </div>
      )}

      {leg.current && leg.exp_bikes !== null && (
        <p className="text-[length:var(--fs-sm)] text-ink-2">
          {role === 'origin'
            ? COPY.trip.expectedThenBikes(Math.round(leg.exp_bikes))
            : COPY.trip.expectedThenDocks(
                Math.max(0, Math.round(leg.current.cap_eff - leg.exp_bikes)),
              )}
        </p>
      )}

      <AlternativesList
        alternatives={leg.alternatives}
        target={target}
        forceExpanded={forceExpandedAlternatives}
      />
    </div>
  );
}
