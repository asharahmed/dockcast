/**
 * Trip check result card: verdict, computed line, two `TripLeg` blocks,
 * footer actions. ui-spec.md §4.1 `TripResult` (also used by `/trip`).
 */
import { VerdictChip } from '../forecast/VerdictChip.js';
import { TripLeg } from './TripLeg.js';
import { ShareButton } from './ShareButton.js';
import { SaveAsCommuteButton } from './SaveAsCommuteButton.js';
import { fmtLocalTime } from '../../lib/time.js';
import { COPY } from '../../lib/constants.js';
import type { TripResponse } from '../../api/types.js';

export interface TripResultProps {
  trip: TripResponse;
  cityTz: string;
  shareUrl: string;
}

export function TripResult({ trip, cityTz, shareUrl }: TripResultProps) {
  const computedAt = fmtLocalTime(new Date(trip.computed_at), cityTz);
  const forecastT0 = trip.forecast_t0 ? fmtLocalTime(new Date(trip.forecast_t0), cityTz) : null;

  return (
    <div aria-live="polite" className="flex flex-col gap-4 @container">
      <div className="flex flex-wrap items-center gap-3">
        <VerdictChip verdict={trip.verdict} />
        <span className="text-[length:var(--fs-sm)] text-ink-3">
          {COPY.trip.computedLine(computedAt, forecastT0)}
        </span>
      </div>

      <div className="divide-y divide-rule border-y border-rule">
        <TripLeg leg={trip.origin} role="origin" time={new Date(trip.depart_at)} cityTz={cityTz} />
        <TripLeg leg={trip.dest} role="dest" time={new Date(trip.arrive_at)} cityTz={cityTz} />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <ShareButton url={shareUrl} />
        <SaveAsCommuteButton
          originId={trip.origin.station.id}
          destId={trip.dest.station.id}
          departAt={new Date(trip.depart_at)}
          rideMinutes={trip.ride_minutes}
          cityTz={cityTz}
        />
      </div>
    </div>
  );
}
