/**
 * Shares the live MapLibre instance from `CityMap` down to `StationLayer`
 * without prop-drilling. Internal plumbing, not part of ui-spec.md's file
 * table, but required to keep `CityMap`/`StationLayer` as separate files per
 * its component split.
 */
import { createContext, useContext } from 'react';
import type { Map as MaplibreMap } from 'maplibre-gl';

export interface MapContextValue {
  map: MaplibreMap | null;
}

export const MapContext = createContext<MapContextValue>({ map: null });

export function useMapInstance(): MaplibreMap | null {
  return useContext(MapContext).map;
}
