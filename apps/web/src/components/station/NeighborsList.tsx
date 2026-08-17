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
          <li key={n.id} className="flex items-center justify-between gap-3 py-2 text-[length:var(--fs-sm)]">
            <Link to={`/station/${n.id}`} className="text-signal underline underline-offset-4">
              {n.name}
            </Link>
            <span className="text-ink-3">{`${Math.round(n.distance_m)} m`}</span>
            <span className="text-ink-2">
              {n.bikes === null || n.docks === null ? '—' : `${n.bikes} bikes · ${n.docks} docks`}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
