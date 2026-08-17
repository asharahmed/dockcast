/**
 * `/` — the map. ui-spec.md §4.1.
 */
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useCities, useStations, useMap } from '../api/queries.js';
import { useCity } from '../hooks/useCity.js';
import { useMediaQuery } from '../hooks/useMediaQuery.js';
import { useNow } from '../hooks/useNow.js';
import { useDocumentTitle } from '../hooks/useDocumentTitle.js';
import { CityMap, type CityMapPoint } from '../components/map/CityMap.js';
import { StationLayer } from '../components/map/StationLayer.js';
import { StationSearch } from '../components/map/StationSearch.js';
import { StationPanel } from '../components/map/StationPanel.js';
import { MapLegend } from '../components/map/MapLegend.js';
import { StationListView } from '../components/map/StationListView.js';
import { TargetToggle } from '../components/forecast/TargetToggle.js';
import { HorizonSlider } from '../components/forecast/HorizonSlider.js';
import { FreshnessNote } from '../components/forecast/FreshnessNote.js';
import { Sheet, type SheetSnap } from '../components/ui/Sheet.js';
import { IconButton } from '../components/ui/IconButton.js';
import { EmptyState } from '../components/ui/EmptyState.js';
import { Skeleton } from '../components/ui/Skeleton.js';
import { COPY } from '../lib/constants.js';
import type { Target } from '../lib/prob.js';

export default function MapPage() {
  useDocumentTitle('DockCast');
  const now = useNow();
  const isDesktop = useMediaQuery('(min-width: 768px)');

  const { data: citiesData, isLoading: citiesLoading } = useCities();
  const cities = citiesData?.cities ?? [];
  const [slug, setSlug] = useCity(cities[0]?.slug);

  useEffect(() => {
    if (!slug && cities[0]) setSlug(cities[0].slug);
  }, [slug, cities, setSlug]);

  const city = cities.find((c) => c.slug === slug) ?? cities[0];

  const stationsQuery = useStations(city?.slug);
  const mapQuery = useMap(city?.slug);

  const [searchParams, setSearchParams] = useSearchParams();
  const selectedId = searchParams.get('station') ? Number(searchParams.get('station')) : null;
  const target: Target = searchParams.get('target') === 'docks' ? 'docks' : 'bikes';
  const horizonIndex = Math.min(6, Math.max(0, Number(searchParams.get('h') ?? '0') || 0));

  const [listView, setListView] = useState(false);
  const [sheetSnap, setSheetSnap] = useState<SheetSnap>('peek');
  const [flyTarget, setFlyTarget] = useState<CityMapPoint | null>(null);

  function updateParam(key: string, value: string | null) {
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        if (value === null) params.delete(key);
        else params.set(key, value);
        return params;
      },
      { replace: true },
    );
  }

  function selectStation(id: number | null) {
    updateParam('station', id === null ? null : String(id));
  }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && selectedId !== null) selectStation(null);
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [selectedId]);

  if (citiesLoading && cities.length === 0) {
    return (
      <div className="flex h-[calc(100dvh-56px)] items-center justify-center">
        <Skeleton width={280} height={32} />
      </div>
    );
  }

  if (!city) {
    return (
      <div className="flex h-[calc(100dvh-56px)] items-center justify-center px-[var(--gutter)]">
        <EmptyState icon="map" title="No cities configured yet." />
      </div>
    );
  }

  const stations = stationsQuery.data?.stations ?? [];
  const mapStations = mapQuery.data?.stations ?? [];
  const selectedMapStation = selectedId !== null ? (mapStations.find((s) => s.id === selectedId) ?? null) : null;
  const selectedMeta = selectedId !== null ? (stations.find((s) => s.id === selectedId) ?? null) : null;

  const t0 = mapQuery.data?.t0 ? new Date(mapQuery.data.t0) : null;
  const staleMinutes = t0 ? Math.round((now.getTime() - t0.getTime()) / 60_000) : null;
  const asOf = mapQuery.data?.as_of ? new Date(mapQuery.data.as_of) : now;

  function onSearchSelect(id: number) {
    selectStation(id);
    const s = stations.find((st) => st.id === id);
    if (s) setFlyTarget({ lat: s.lat, lon: s.lon });
  }

  const controlPanel = (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <div className="flex-1">
          <StationSearch stations={stations} mapStations={mapStations} onSelect={onSearchSelect} />
        </div>
        <IconButton
          icon="list"
          aria-label={listView ? 'Show map' : COPY.map.listToggle}
          onClick={() => setListView((v) => !v)}
        />
      </div>

      {mapQuery.isError ? (
        <EmptyState
          icon="alert"
          title={COPY.map.couldntLoad}
          action={{ label: COPY.map.retry, onClick: () => mapQuery.refetch() }}
        />
      ) : (
        <>
          {city.forecasting_enabled && (
            <>
              <TargetToggle value={target} onChange={(t) => updateParam('target', t)} />
              <p className="text-[length:var(--fs-sm)] text-ink-2">{COPY.map.targetSub[target]}</p>
              <HorizonSlider
                value={horizonIndex}
                onChange={(v) => updateParam('h', String(v))}
                cityTz={city.tz}
                now={now}
              />
              {staleMinutes !== null && staleMinutes > 15 && <FreshnessNote minutesOld={staleMinutes} />}
            </>
          )}

          {stations.length === 0 ? (
            <p className="text-[length:var(--fs-sm)] text-ink-2">{COPY.map.noStations(city.name)}</p>
          ) : selectedMapStation && selectedMeta ? (
            <StationPanel
              station={selectedMapStation}
              name={selectedMeta.name}
              onClose={() => selectStation(null)}
              now={now}
              asOf={asOf}
            />
          ) : (
            <div className="flex flex-col gap-2">
              <h2 className="text-[length:var(--fs-lg)]">{COPY.map.plannerPlaceholderTitle}</h2>
              <p className="text-[length:var(--fs-sm)] text-ink-2">{COPY.map.plannerPlaceholderBody}</p>
            </div>
          )}
        </>
      )}
    </div>
  );

  return (
    <div className="relative h-[calc(100dvh-56px)] w-full overflow-hidden">
      {listView ? (
        <div className="h-full overflow-y-auto p-[var(--gutter)]">
          <StationListView
            stations={stations}
            mapStations={mapStations}
            horizonIndex={horizonIndex}
            onSelect={(id) => {
              selectStation(id);
              setListView(false);
            }}
          />
        </div>
      ) : (
        <CityMap
          center={{ lat: city.lat, lon: city.lon }}
          fitKey={city.slug}
          fitPoints={stations.map((s) => ({ lat: s.lat, lon: s.lon }))}
          panelPaddingPx={360}
          ariaLabel={COPY.map.mapAriaLabel(city.name)}
          hiddenFromA11y={listView}
          flyToPoint={flyTarget}
        >
          <StationLayer
            stations={stations}
            mapStations={mapStations}
            target={target}
            horizonIndex={horizonIndex}
            selectedId={selectedId}
            onSelect={selectStation}
          />
        </CityMap>
      )}

      {isDesktop ? (
        <div className="pointer-events-none absolute inset-0 flex items-start justify-between gap-4 p-[var(--sp-4)]">
          <div className="pointer-events-auto w-[360px] max-h-full overflow-y-auto">
            <Sheet open title="Control panel" onClose={() => undefined}>
              {controlPanel}
            </Sheet>
          </div>
          <div className="pointer-events-auto mt-auto w-[280px]">
            {!listView && (
              <MapLegend
                target={target}
                horizonIndex={horizonIndex}
                now={now}
                asOf={asOf}
                stationCount={mapStations.length}
                forecastingEnabled={city.forecasting_enabled}
                cityName={city.name}
              />
            )}
          </div>
        </div>
      ) : (
        <>
          <Sheet
            open
            snap={sheetSnap}
            onSnapChange={setSheetSnap}
            onClose={() => setSheetSnap('peek')}
            title="Control panel"
          >
            {controlPanel}
          </Sheet>
          {!listView && (
            <div className="pointer-events-none absolute bottom-[calc(96px+var(--sp-3))] right-[var(--sp-3)]">
              <div className="pointer-events-auto w-[240px]">
                <MapLegend
                  target={target}
                  horizonIndex={horizonIndex}
                  now={now}
                  asOf={asOf}
                  stationCount={mapStations.length}
                  forecastingEnabled={city.forecasting_enabled}
                  cityName={city.name}
                />
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
