/**
 * `/station/:id`. ui-spec.md §4.2.
 */
import { useState } from 'react';
import { useParams } from 'react-router';
import { useStation, useStationHistory } from '../api/queries.js';
import { ApiError } from '../api/client.js';
import { StationHeader } from '../components/station/StationHeader.js';
import { CurrentState } from '../components/station/CurrentState.js';
import { ForecastTable } from '../components/station/ForecastTable.js';
import { StationChart } from '../components/station/StationChart.js';
import { TypicalDay } from '../components/station/TypicalDay.js';
import { NeighborsList } from '../components/station/NeighborsList.js';
import { Skeleton } from '../components/ui/Skeleton.js';
import { SegmentedControl } from '../components/ui/SegmentedControl.js';
import { NotFound } from '../components/shell/NotFound.js';
import { COPY } from '../lib/constants.js';
import { useDocumentTitle } from '../hooks/useDocumentTitle.js';
import { useNow } from '../hooks/useNow.js';

export default function StationPage() {
  const params = useParams<{ id: string }>();
  const id = params.id ? Number(params.id) : undefined;
  const { data, isLoading, isError, error } = useStation(id);
  const now = useNow();
  const [range, setRange] = useState<'24' | '168'>('24');
  const extendedHistory = useStationHistory(range === '168' ? id : undefined, 168);

  useDocumentTitle(data ? `${data.station.name} · DockCast` : 'Station · DockCast');

  if (isError && error instanceof ApiError && error.status === 404) {
    return (
      <NotFound
        title={COPY.stationNotFound.title}
        body={undefined}
        linkTo="/"
        linkLabel={COPY.stationNotFound.link}
        documentTitle="Not found · DockCast"
      />
    );
  }

  if (isLoading || !data) {
    return (
      <div className="mx-auto flex max-w-[1200px] flex-col gap-8 px-[var(--gutter)] py-[var(--sp-7)]">
        <Skeleton height={80} />
        <Skeleton height={200} />
        <Skeleton height={300} />
      </div>
    );
  }

  const history = range === '168' && extendedHistory.data ? extendedHistory.data.points : data.history;

  return (
    <div className="mx-auto flex max-w-[1200px] flex-col gap-[var(--sp-7)] px-[var(--gutter)] py-[var(--sp-7)]">
      <StationHeader
        cityName={data.station.city.name}
        name={data.station.name}
        stationId={data.station.station_id}
        capacity={data.station.capacity}
        mapHref={`/?station=${data.station.id}`}
      />

      <div className="grid grid-cols-1 gap-x-8 gap-y-8 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex flex-col gap-[var(--sp-7)]">
          <CurrentState current={data.current} now={now} />
          <ForecastTable forecasts={data.forecasts} cityTz={data.station.city.tz} />

          <SegmentedControl
            ariaLabel="History range"
            value={range}
            onChange={setRange}
            options={[
              { value: '24', label: '24 h' },
              { value: '168', label: '7 d' },
            ]}
          />
          <StationChart
            history={history}
            forecasts={data.forecasts}
            current={data.current}
            capacity={data.station.capacity}
            cityTz={data.station.city.tz}
            now={now}
          />
        </div>

        <div className="flex flex-col gap-[var(--sp-7)]">
          <TypicalDay typical={data.typical} now={now} cityTz={data.station.city.tz} />
          <NeighborsList neighbors={data.neighbors} />
        </div>
      </div>
    </div>
  );
}
