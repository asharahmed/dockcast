/**
 * Combobox station search. ui-spec.md §4.1, §10 (combobox pattern).
 */
import { useId, useState, type KeyboardEvent } from 'react';
import { Icon } from '../ui/Icon.js';
import { COPY } from '../../lib/constants.js';
import type { StationListItem, MapStation } from '../../api/types.js';

export interface StationSearchProps {
  stations: StationListItem[];
  mapStations: MapStation[];
  onSelect: (id: number) => void;
}

const COMBINING_MARKS_RE = new RegExp('[' + String.fromCharCode(0x0300) + '-' + String.fromCharCode(0x036f) + ']', 'g');

function normalize(value: string): string {
  return value.normalize('NFD').replace(COMBINING_MARKS_RE, '').toLowerCase();
}

export function StationSearch({ stations, mapStations, onSelect }: StationSearchProps) {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(-1);
  const inputId = useId();
  const listboxId = useId();
  const byId = new Map(mapStations.map((m) => [m.id, m]));

  const trimmed = query.trim();
  const results = trimmed
    ? stations
        .filter(
          (s) =>
            normalize(s.name).includes(normalize(trimmed)) ||
            normalize(s.station_id).includes(normalize(trimmed)),
        )
        .slice(0, 8)
    : [];

  function commit(id: number) {
    onSelect(id);
    setQuery('');
    setActiveIndex(-1);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (results.length === 0) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((i) => Math.min(results.length - 1, i + 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((i) => Math.max(0, i - 1));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const target = results[activeIndex] ?? results[0];
      if (target) commit(target.id);
    } else if (event.key === 'Escape') {
      setQuery('');
      setActiveIndex(-1);
    }
  }

  return (
    <div className="relative">
      <label htmlFor={inputId} className="visually-hidden">
        {COPY.map.searchLabel}
      </label>
      <div className="flex items-center gap-2 rounded-[var(--r-1)] border border-rule-strong bg-surface px-3 py-2">
        <Icon name="search" size={18} className="text-ink-3" />
        <input
          id={inputId}
          type="text"
          role="combobox"
          aria-expanded={results.length > 0}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={activeIndex >= 0 ? `${listboxId}-${activeIndex}` : undefined}
          autoComplete="off"
          placeholder={COPY.map.searchPlaceholder}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActiveIndex(-1);
          }}
          onKeyDown={onKeyDown}
          className="w-full bg-transparent text-[length:var(--fs-sm)] text-ink outline-none placeholder:text-ink-3"
        />
      </div>
      {trimmed && (
        <ul
          id={listboxId}
          role="listbox"
          aria-label={COPY.map.searchLabel}
          className="absolute z-10 mt-1 w-full rounded-[var(--r-2)] border border-rule bg-surface py-1"
          style={{ boxShadow: 'var(--shadow-panel)' }}
        >
          {results.length === 0 && (
            <li className="px-3 py-2 text-[length:var(--fs-sm)] text-ink-3">
              {COPY.map.noMatch(trimmed)}
            </li>
          )}
          {results.map((station, index) => {
            const mapStation = byId.get(station.id);
            return (
              <li
                key={station.id}
                id={`${listboxId}-${index}`}
                role="option"
                aria-selected={index === activeIndex}
                className={`cursor-pointer px-3 py-2 text-[length:var(--fs-sm)] ${
                  index === activeIndex ? 'bg-signal-wash' : ''
                }`}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => commit(station.id)}
              >
                <p className="text-ink">{station.name}</p>
                {mapStation && (
                  <p className="text-ink-3">{COPY.map.stationCounts(mapStation.b, mapStation.d)}</p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
