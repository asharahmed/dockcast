/**
 * ui-spec.md §4.2 `NeighborsList`.
 */
import { Link } from 'react-router';
import { COPY } from '../../lib/constants.js';
import type { StationNeighbor } from '../../api/types.js';

export function NeighborsList({ neighbors }: { neighbors: StationNeighbor[] }) {
  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-[length:var(--fs-md)] font-medium">{COPY.station.neighborsHeading}</h2>
      <ul className="flex flex-col divide-y divide-rule">
        {neighbors.map((n) => (
          <li key={n.id} className="grid grid-cols-[1fr_auto] items-center gap-x-3 py-2 text-[length:var(--fs-sm)]">
            <Link to={`/station/${n.id}`} className="inline-flex min-h-11 items-center text-signal underline underline-offset-4">
              {n.name}
            </Link>
            <span className="flex flex-col items-end whitespace-nowrap tabular-nums">
              <span className="text-ink-2">
                {n.bikes === null || n.docks === null ? '—' : COPY.map.stationCounts(n.bikes, n.docks)}
              </span>
              <span className="text-[length:var(--fs-xs)] text-ink-3">{`${Math.round(n.distance_m)} m away`}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
