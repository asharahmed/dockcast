/**
 * Accessible list twin of the map: name · bikes · docks · P(bike) · P(dock).
 * ui-spec.md §10.
 */
import { useMemo, useState } from 'react';
import { ProbBadge } from '../forecast/ProbBadge.js';
import { mapProbAt } from '../../lib/prob.js';
import type { StationListItem, MapStation } from '../../api/types.js';

export interface StationListViewProps {
  stations: StationListItem[];
  mapStations: MapStation[];
  horizonIndex: number;
  onSelect: (id: number) => void;
}

export function StationListView({
  stations,
  mapStations,
  horizonIndex,
  onSelect,
}: StationListViewProps) {
  const [filter, setFilter] = useState('');
  const byId = new Map(mapStations.map((m) => [m.id, m]));

  const rows = useMemo(() => {
    const filtered = filter.trim()
      ? stations.filter((s) => s.name.toLowerCase().includes(filter.trim().toLowerCase()))
      : stations;
    return [...filtered].sort((a, b) => a.name.localeCompare(b.name));
  }, [stations, filter]);

  return (
    <div className="flex flex-col gap-3">
      <label className="flex flex-col gap-1 text-[length:var(--fs-sm)] text-ink-2">
        Filter stations
        <input
          type="text"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          className="rounded-[var(--r-1)] border border-rule-strong bg-surface px-3 py-2 text-ink"
        />
      </label>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-[length:var(--fs-sm)]">
          <caption className="visually-hidden">Stations</caption>
          <thead>
            <tr className="border-b border-rule text-ink-3">
              <th className="py-2 pr-3 font-medium">Name</th>
              <th className="py-2 pr-3 font-medium">Bikes</th>
              <th className="py-2 pr-3 font-medium">Docks</th>
              <th className="py-2 pr-3 font-medium">P(bike)</th>
              <th className="py-2 font-medium">P(dock)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((station) => {
              const mapStation = byId.get(station.id);
              const bike = mapStation ? mapProbAt(mapStation, 'bikes', horizonIndex) : null;
              const dock = mapStation ? mapProbAt(mapStation, 'docks', horizonIndex) : null;
              return (
                <tr key={station.id} className="border-b border-rule">
                  <td className="py-2 pr-3">
                    <button
                      type="button"
                      onClick={() => onSelect(station.id)}
                      className="text-signal underline underline-offset-4"
                    >
                      {station.name}
                    </button>
                  </td>
                  <td className="py-2 pr-3 tabular-nums">{mapStation?.b ?? '—'}</td>
                  <td className="py-2 pr-3 tabular-nums">{mapStation?.d ?? '—'}</td>
                  <td className="py-2 pr-3">
                    <ProbBadge p={bike && bike.p >= 0 ? bike.p : null} size="sm" />
                  </td>
                  <td className="py-2">
                    <ProbBadge p={dock && dock.p >= 0 ? dock.p : null} size="sm" />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
