/**
 * `/trip` — shareable trip check. ui-spec.md §4.3.
 */
import { Link, useSearchParams } from 'react-router';
import { useDocumentTitle } from '../hooks/useDocumentTitle.js';
import { useNow } from '../hooks/useNow.js';
import { useCities, useStations, useMap } from '../api/queries.js';
import { useCity } from '../hooks/useCity.js';
import { TripPlanner, parseTripSearchParams } from '../components/trip/TripPlanner.js';
import { Skeleton } from '../components/ui/Skeleton.js';
import { EmptyState } from '../components/ui/EmptyState.js';
import { COPY } from '../lib/constants.js';

export default function TripPage() {
  useDocumentTitle('Trip check · DockCast');
  const now = useNow();
  const { data: citiesData, isLoading: citiesLoading } = useCities();
  const cities = citiesData?.cities ?? [];
  const [slug] = useCity(cities[0]?.slug);
  const city = cities.find((c) => c.slug === slug) ?? cities[0];
  const stationsQuery = useStations(city?.slug);
  const mapQuery = useMap(city?.slug);
  const [searchParams] = useSearchParams();
  const urlParams = parseTripSearchParams(searchParams);
  const submitted = urlParams.origin !== null && urlParams.dest !== null;

  if (citiesLoading && cities.length === 0) {
    return (
      <div className="mx-auto flex max-w-[720px] flex-col gap-4 px-[var(--gutter)] py-[var(--sp-8)]">
        <Skeleton height={32} width={200} />
        <Skeleton height={200} />
      </div>
    );
  }

  if (!city) {
    return (
      <div className="mx-auto max-w-[720px] px-[var(--gutter)] py-[var(--sp-8)]">
        <h1 className="text-[length:var(--fs-2xl)]">{COPY.trip.title}</h1>
        <EmptyState icon="map" title="No cities configured yet." />
      </div>
    );
  }

  const stations = stationsQuery.data?.stations ?? [];
  const mapStations = mapQuery.data?.stations ?? [];
  const mapHref = submitted
    ? `/?from=${urlParams.origin}&to=${urlParams.dest}&at=${
        urlParams.departAt ? encodeURIComponent(urlParams.departAt.toISOString()) : ''
      }&ride=${urlParams.rideMinutes ?? ''}`
    : '/';

  return (
    <div className="mx-auto flex max-w-[720px] flex-col gap-6 px-[var(--gutter)] py-[var(--sp-8)]">
      <h1 className="text-[length:var(--fs-2xl)]">{COPY.trip.title}</h1>
      <TripPlanner
        stations={stations}
        mapStations={mapStations}
        cityTz={city.tz}
        now={now}
        emptyHint={COPY.trip.fromUrlPrompt}
      />
      {submitted && (
        <Link
          to={mapHref}
          className="text-[length:var(--fs-sm)] font-medium text-signal underline underline-offset-4"
        >
          {COPY.trip.openOnMap}
        </Link>
      )}
    </div>
  );
}
