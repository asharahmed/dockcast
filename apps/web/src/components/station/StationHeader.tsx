/**
 * ui-spec.md §4.2 `StationHeader`.
 */
import { Link } from 'react-router';
import { COPY } from '../../lib/constants.js';

export interface StationHeaderProps {
  cityName: string;
  name: string;
  stationId: string;
  capacity: number | null;
  mapHref: string;
}

export function StationHeader({ cityName, name, stationId, capacity, mapHref }: StationHeaderProps) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex flex-col gap-1">
        <Link to="/" className="text-[length:var(--fs-sm)] text-ink-2 underline underline-offset-4">
          {cityName}
        </Link>
        <h1 className="font-[var(--font-display)] text-[length:var(--fs-2xl)] font-semibold">
          {name}
        </h1>
        <p className="text-[length:var(--fs-sm)] text-ink-3">
          {`${stationId} · capacity ${capacity ?? '—'}`}
        </p>
      </div>
      <Link
        to={mapHref}
        className="text-[length:var(--fs-sm)] font-medium text-signal underline underline-offset-4"
      >
        {COPY.station.showOnMap}
      </Link>
    </div>
  );
}
