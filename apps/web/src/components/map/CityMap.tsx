/**
 * MapLibre wrapper: owns the `maplibregl.Map` instance, theme-aware style
 * swap, controls, and `fitBounds`. ui-spec.md §4.1 "Map".
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { MapContext } from './MapContext.js';
import { useTheme } from '../../hooks/useTheme.js';
import { useMediaQuery } from '../../hooks/useMediaQuery.js';

const STYLE_URL = {
  light: 'https://tiles.openfreemap.org/styles/positron',
  dark: 'https://tiles.openfreemap.org/styles/dark',
};

export interface CityMapPoint {
  lat: number;
  lon: number;
}

export interface CityMapProps {
  center: CityMapPoint;
  /** Refit the view to `fitPoints` whenever this key changes (e.g. city slug). */
  fitKey: string;
  fitPoints: CityMapPoint[];
  /** Left padding for `fitBounds` so the docked panel doesn't cover stations (desktop only). */
  panelPaddingPx: number;
  ariaLabel: string;
  /** Hide the map canvas from assistive tech when `StationListView` replaces it. */
  hiddenFromA11y?: boolean;
  /** `StationSearch` selection flies the camera here (zoom 15, ui-spec.md §4.1). `null` = no pending fly. */
  flyToPoint?: CityMapPoint | null;
  children?: ReactNode;
}

export function CityMap({
  center,
  fitKey,
  fitPoints,
  panelPaddingPx,
  ariaLabel,
  hiddenFromA11y = false,
  flyToPoint = null,
  children,
}: CityMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const styleUrlRef = useRef<string | null>(null);
  const [ready, setReady] = useState(false);
  const [themePref] = useTheme();
  const prefersDark = useMediaQuery('(prefers-color-scheme: dark)');
  const isDark = themePref === 'dark' || (themePref === 'system' && prefersDark);
  const isDesktop = useMediaQuery('(min-width: 1024px)');

  // Mount/unmount the map instance once.
  useEffect(() => {
    if (!containerRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: isDark ? STYLE_URL.dark : STYLE_URL.light,
      center: [center.lon, center.lat],
      zoom: 12.5,
      maxZoom: 18,
      minZoom: 10,
      attributionControl: false,
    });
    // Phones: the bottom sheet covers the lower edge of the map, so zoom/locate move
    // to the top-right corner. The legend chip takes the top-left (MapPage).
    const narrow = window.matchMedia('(max-width: 767.98px)').matches;
    const controlCorner = narrow ? 'top-right' : 'bottom-right';
    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-left');
    map.addControl(new maplibregl.NavigationControl(), controlCorner);
    map.addControl(
      new maplibregl.GeolocateControl({ positionOptions: { enableHighAccuracy: true } }),
      controlCorner,
    );
    map.on('load', () => {
      map.getCanvas().setAttribute('role', 'img');
      map.getCanvas().setAttribute('aria-label', ariaLabel);
      setReady(true);
    });
    mapRef.current = map;
    styleUrlRef.current = isDark ? STYLE_URL.dark : STYLE_URL.light;

    return () => {
      map.remove();
      mapRef.current = null;
    };
    // Only the initial center seeds the map; later moves happen via fitBounds.
  }, []);

  // Swap the basemap style on theme change; re-adds sources/layers via StationLayer's own 'style.load' listener.
  // `styleUrlRef` tracks the style currently applied so the initial mount (already on the right style)
  // is a no-op, and a toggle that lands while a style is still loading is applied once it finishes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const target = isDark ? STYLE_URL.dark : STYLE_URL.light;
    if (styleUrlRef.current === target) return;
    const apply = (): void => {
      styleUrlRef.current = target;
      setReady(false);
      map.setStyle(target);
      map.once('style.load', () => setReady(true));
    };
    if (map.isStyleLoaded()) apply();
    else map.once('style.load', apply);
  }, [isDark]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.getCanvas().setAttribute('aria-label', ariaLabel);
  }, [ariaLabel]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (hiddenFromA11y) map.getCanvas().setAttribute('aria-hidden', 'true');
    else map.getCanvas().removeAttribute('aria-hidden');
  }, [hiddenFromA11y]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || fitPoints.length === 0) return;
    const bounds = fitPoints.reduce(
      (acc, p) => acc.extend([p.lon, p.lat]),
      new maplibregl.LngLatBounds([fitPoints[0]!.lon, fitPoints[0]!.lat], [
        fitPoints[0]!.lon,
        fitPoints[0]!.lat,
      ]),
    );
    map.fitBounds(bounds, {
      padding: { top: 24, left: isDesktop ? panelPaddingPx + 24 : 24, right: 24, bottom: 24 },
      maxZoom: 15,
      duration: 0,
    });
  }, [fitKey, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !flyToPoint) return;
    map.flyTo({ center: [flyToPoint.lon, flyToPoint.lat], zoom: 15 });
  }, [flyToPoint, ready]);

  // Two layers: an empty leaf div MapLibre owns outright (it inserts its own
  // canvas/control DOM imperatively — mixing React children into that same
  // node would fight React's reconciliation), and a sibling overlay div that
  // hosts React-rendered UI (StationLayer's hover tooltip) positioned above it.
  return (
    <div className="relative h-full w-full">
      {/* `!absolute`: maplibre-gl.css sets `.maplibregl-map { position: relative }` on this
          element (MapLibre appends that class itself); because maplibre-gl.css is imported
          inside this lazy-loaded route chunk, it lands after Tailwind's utilities in the
          bundled CSS and wins the position cascade tie, collapsing this div (and the map) to
          zero height. The important modifier forces Tailwind's `absolute` to win regardless of
          import order. See WP-12 final report. */}
      <div ref={containerRef} className="!absolute inset-0" />
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <MapContext.Provider value={{ map: ready ? mapRef.current : null }}>
          {ready && children}
        </MapContext.Provider>
      </div>
    </div>
  );
}
