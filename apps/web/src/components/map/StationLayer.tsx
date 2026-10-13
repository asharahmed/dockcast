/**
 * GeoJSON source + circle/label layers + selection + hover tooltip.
 * ui-spec.md §4.1 "Map". Rebuilds `source.setData` on every data/target/
 * horizon change; never recreates layers (layers are only ever created once
 * per mount — `CityMap` remounts this component on every style swap, which
 * is when ui-spec.md requires "re-add sources/layers on `style.load`").
 */
import { useEffect, useRef, useState } from 'react';
import type { GeoJSONSource, MapLayerMouseEvent, MapMouseEvent } from 'maplibre-gl';
import type { Feature, FeatureCollection, Point } from 'geojson';
import { useMapInstance } from './MapContext.js';
import { mapProbAt, probStep, fmtPct, type Target } from '../../lib/prob.js';
import { horizonDurationLabel, HORIZON_STOPS } from '../../lib/time.js';
import type { StationListItem, MapStation } from '../../api/types.js';
import { COPY } from '../../lib/constants.js';

const SOURCE_ID = 'stations';
const LAYER_ID = 'stations';
const SELECTED_LAYER_ID = 'stations-selected';
const LABELS_LAYER_ID = 'stations-labels';

export interface StationFeatureProps {
  id: number;
  name: string;
  b: number;
  d: number;
  c: number;
  fresh: boolean;
  p: number;
  exp: number | null;
  step: number;
}

export interface StationLayerProps {
  stations: StationListItem[];
  mapStations: MapStation[];
  target: Target;
  horizonIndex: number;
  selectedId: number | null;
  onSelect: (id: number | null) => void;
}

interface HoverInfo {
  x: number;
  y: number;
  props: StationFeatureProps;
}

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function buildFeatureCollection(
  stations: StationListItem[],
  mapStations: MapStation[],
  target: Target,
  horizonIndex: number,
): FeatureCollection<Point, StationFeatureProps> {
  const byId = new Map(mapStations.map((m) => [m.id, m]));
  const features: Feature<Point, StationFeatureProps>[] = [];
  for (const station of stations) {
    const mapStation = byId.get(station.id);
    if (!mapStation) continue;
    const { p, exp } = mapProbAt(mapStation, target, horizonIndex);
    const step = probStep(p === -1 ? null : p);
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [station.lon, station.lat] },
      properties: {
        id: station.id,
        name: station.name,
        b: mapStation.b,
        d: mapStation.d,
        c: mapStation.c,
        fresh: mapStation.fresh,
        p,
        exp,
        step,
      },
    });
  }
  return { type: 'FeatureCollection', features };
}

export function StationLayer({
  stations,
  mapStations,
  target,
  horizonIndex,
  selectedId,
  onSelect,
}: StationLayerProps) {
  const map = useMapInstance();
  const [hover, setHover] = useState<HoverInfo | null>(null);
  const initializedRef = useRef(false);

  // Create the source + layers once per mount.
  useEffect(() => {
    if (!map || initializedRef.current) return;
    initializedRef.current = true;

    const ringColor = cssVar('--map-ring');
    const noneColor = cssVar('--p-none');
    const signalColor = cssVar('--signal');
    const inkColor = cssVar('--ink-2');
    const surfaceColor = cssVar('--surface');
    const stepColors: [string, string, string, string, string] = [
      cssVar('--p0'),
      cssVar('--p1'),
      cssVar('--p2'),
      cssVar('--p3'),
      cssVar('--p4'),
    ];

    map.addSource(SOURCE_ID, {
      type: 'geojson',
      data: buildFeatureCollection(stations, mapStations, target, horizonIndex),
    });

    map.addLayer({
      id: LAYER_ID,
      type: 'circle',
      source: SOURCE_ID,
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 3, 13, 6, 16, 10],
        'circle-color': [
          'match',
          ['get', 'step'],
          0,
          stepColors[0],
          1,
          stepColors[1],
          2,
          stepColors[2],
          3,
          stepColors[3],
          4,
          stepColors[4],
          'transparent',
        ],
        'circle-stroke-width': ['case', ['==', ['get', 'step'], -1], 1.5, 2],
        'circle-stroke-color': [
          'case',
          ['==', ['get', 'step'], -1],
          noneColor,
          ringColor,
        ],
        'circle-color-transition': { duration: 200 },
      },
    });

    map.addLayer({
      id: SELECTED_LAYER_ID,
      type: 'circle',
      source: SOURCE_ID,
      filter: ['==', ['get', 'id'], -1],
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 7, 13, 10, 16, 14],
        'circle-color': 'transparent',
        'circle-stroke-width': 3,
        'circle-stroke-color': signalColor,
      },
    });

    map.addLayer({
      id: LABELS_LAYER_ID,
      type: 'symbol',
      source: SOURCE_ID,
      minzoom: 15,
      layout: {
        'text-field': ['get', 'name'],
        'text-font': ['Noto Sans Regular'],
        'text-size': 11,
        'text-offset': [0, 1.2],
        'text-anchor': 'top',
        'text-optional': true,
      },
      paint: {
        'text-color': inkColor,
        'text-halo-color': surfaceColor,
        'text-halo-width': 1.2,
      },
    });

    const onEnter = () => {
      map.getCanvas().style.cursor = 'pointer';
    };
    const onLeave = () => {
      map.getCanvas().style.cursor = '';
      setHover(null);
    };
    const onMove = (event: MapLayerMouseEvent) => {
      const feature = event.features?.[0];
      if (!feature) return;
      setHover({
        x: event.point.x,
        y: event.point.y,
        props: feature.properties as StationFeatureProps,
      });
    };
    const onClick = (event: MapMouseEvent) => {
      const hits = map.queryRenderedFeatures(event.point, { layers: [LAYER_ID] });
      const feature = hits[0];
      onSelect(feature ? Number(feature.properties?.id) : null);
    };

    map.on('mouseenter', LAYER_ID, onEnter);
    map.on('mouseleave', LAYER_ID, onLeave);
    map.on('mousemove', LAYER_ID, onMove);
    map.on('click', onClick);

    return () => {
      map.off('mouseenter', LAYER_ID, onEnter);
      map.off('mouseleave', LAYER_ID, onLeave);
      map.off('mousemove', LAYER_ID, onMove);
      map.off('click', onClick);
    };
  }, [map]);

  // Rebuild source data on every change — never touches layers.
  useEffect(() => {
    if (!map) return;
    const source = map.getSource(SOURCE_ID) as GeoJSONSource | undefined;
    source?.setData(buildFeatureCollection(stations, mapStations, target, horizonIndex));
  }, [map, stations, mapStations, target, horizonIndex]);

  // Update the selection ring filter.
  useEffect(() => {
    if (!map || !map.getLayer(SELECTED_LAYER_ID)) return;
    map.setFilter(SELECTED_LAYER_ID, ['==', ['get', 'id'], selectedId ?? -1]);
  }, [map, selectedId]);

  if (!hover) return null;

  const { props } = hover;
  // SPEC-GAP: ui-spec.md §4.1 gives the tooltip's content pieces but not the
  // exact horizon phrasing ("<pct> chance of a <bike|dock> at <horizonLabel>");
  // "now"/"in 45 min" reads more naturally than "at Now" and reuses the
  // slider's own duration wording.
  const targetWord = target === 'bikes' ? 'bike' : 'dock';
  const when =
    horizonIndex === 0 ? 'now' : `in ${horizonDurationLabel(HORIZON_STOPS[horizonIndex] ?? 0)}`;

  return (
    <div
      className="absolute z-10 -translate-x-1/2 -translate-y-[calc(100%+10px)] rounded-[var(--r-1)] bg-surface px-3 py-2 text-[length:var(--fs-xs)] text-ink"
      style={{ left: hover.x, top: hover.y, boxShadow: 'var(--shadow-panel)', maxWidth: 220 }}
    >
      <p className="font-medium">{props.name}</p>
      <p className="text-ink-2">{COPY.map.stationCounts(props.b, props.d)}</p>
      <p className="text-ink-2">
        {props.step >= 0 ? `${fmtPct(props.p)} chance of a ${targetWord} ${when}` : 'No forecast'}
      </p>
    </div>
  );
}
