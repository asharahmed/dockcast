/**
 * Mini detail panel for the selected station. ui-spec.md §4.1.
 *
 * "Trip from here"/"Trip to here" navigate to `/trip?from=`/`?to=` — the
 * inline `TripPlanner` prefill described in ui-spec.md §4.1 ships in WP-10;
 * navigating to the (placeholder, until WP-10) `/trip` page is the
 * documented fallback for that gap.
 */
import { useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router';
import { IconButton } from '../ui/IconButton.js';
import { Button } from '../ui/Button.js';
import { Chip } from '../ui/Chip.js';
import { ForecastRow } from '../forecast/ForecastRow.js';
import { HORIZON_STOPS, horizonTickLabel, fmtRelative } from '../../lib/time.js';
import { COPY } from '../../lib/constants.js';
import type { MapStation } from '../../api/types.js';

export interface StationPanelProps {
  station: MapStation;
  name: string;
  onClose: () => void;
  now: Date;
  asOf: Date;
}

export function StationPanel({ station, name, onClose, now, asOf }: StationPanelProps) {
  const navigate = useNavigate();
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, [station.id]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-2">
        <h2 ref={headingRef} tabIndex={-1} className="text-[length:var(--fs-lg)]">
          {name}
        </h2>
        <IconButton icon="close" aria-label={COPY.map.closeStation} onClick={onClose} />
      </div>

      <div className="flex flex-col gap-1.5">
        <p className="text-[length:var(--fs-sm)] text-ink-2">
          {COPY.map.stationCountsWithCapacity(station.b, station.d, station.c)}
        </p>
        {station.fresh ? (
          <p className="text-[length:var(--fs-xs)] text-ink-3">
            {COPY.map.liveUpdated(fmtRelative(asOf, now))}
          </p>
        ) : (
          <Chip tone="serious" icon="alert">
            {COPY.map.notReporting}
          </Chip>
        )}
      </div>

      <div className="divide-y divide-rule">
        {HORIZON_STOPS.slice(1).map((minutes, index) => {
          const entry = station.f[index];
          return (
            <ForecastRow
              key={minutes}
              horizonLabel={horizonTickLabel(minutes)}
              pBike={entry ? entry[0] : null}
              pDock={entry ? entry[1] : null}
            />
          );
        })}
      </div>

      <div className="flex flex-col gap-2">
        <Link
          to={`/station/${station.id}`}
          className="text-[length:var(--fs-sm)] font-medium text-signal"
        >
          {COPY.map.stationDetails}
        </Link>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            icon="bike"
            onClick={() => navigate(`/trip?from=${station.id}`)}
          >
            {COPY.map.tripFromHere}
          </Button>
          <Button
            variant="secondary"
            icon="dock"
            onClick={() => navigate(`/trip?to=${station.id}`)}
          >
            {COPY.map.tripToHere}
          </Button>
        </div>
      </div>
    </div>
  );
}
