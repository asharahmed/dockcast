/**
 * ui-spec.md §4.2 `ForecastTable`. Below 768 px (§6) the six-column table becomes one
 * block per horizon: when, the two probabilities, and the expected count with its range.
 */
import { Link } from 'react-router';
import { useMediaQuery } from '../../hooks/useMediaQuery.js';
import { ProbBadge } from '../forecast/ProbBadge.js';
import { COPY } from '../../lib/constants.js';
import { fmtLocalTime, horizonDurationLabel } from '../../lib/time.js';
import type { StationForecastRow, ServingTier } from '../../api/types.js';

export interface ForecastTableProps {
  forecasts: StationForecastRow[];
  cityTz: string;
}

function reasonText(reason: string | null): string | null {
  switch (reason) {
    case null:
      return null;
    case 'not_fresh':
      return COPY.station.reason.not_fresh;
    case 'zero_capacity':
      return COPY.station.reason.zero_capacity;
    case 'no_rates':
      return COPY.station.reason.no_rates;
    default:
      return COPY.station.reason.other;
  }
}

function tierLabelText(tier: ServingTier): string {
  switch (tier) {
    case 'gbm':
      return COPY.station.tierLabel.gbm;
    case 'bd_cal':
      return COPY.station.tierLabel.bd_cal;
    case 'bd_raw':
      return COPY.station.tierLabel.bd_raw;
    case 'none':
      return COPY.station.tierLabel.none;
  }
}

function servingTierLabel(forecasts: StationForecastRow[]): string {
  const withTier = forecasts.find((f) => f.tier !== 'none');
  return tierLabelText(withTier?.tier ?? 'none');
}

function rangeText(row: StationForecastRow): string | null {
  return row.q10 === null || row.q90 === null ? null : `${Math.round(row.q10)}–${Math.round(row.q90)}`;
}

function ForecastCards({ forecasts, cityTz }: ForecastTableProps) {
  const copy = COPY.station.forecastCard;
  return (
    <ul aria-label={COPY.station.forecastCaption} className="flex flex-col divide-y divide-rule border-y border-rule">
      {forecasts.map((row) => {
        const unavailable = row.p_bike === null && row.p_dock === null;
        const note = reasonText(row.reason);
        return (
          <li
            key={row.horizon}
            data-testid="forecast-card"
            className={`grid grid-cols-[1fr_auto_auto] items-center gap-x-5 gap-y-1 py-3 ${unavailable ? 'text-ink-3' : ''}`}
          >
            <div className="flex flex-col">
              <span className="font-medium tabular-nums">{horizonDurationLabel(row.horizon)}</span>
              <span className="text-[length:var(--fs-xs)] text-ink-3 tabular-nums">
                {fmtLocalTime(new Date(row.valid_at), cityTz)}
              </span>
            </div>
            <div className="flex flex-col items-start gap-0.5">
              <span className="text-[length:var(--fs-xs)] text-ink-3">{copy.bike}</span>
              <ProbBadge p={row.p_bike} />
            </div>
            <div className="flex flex-col items-start gap-0.5">
              <span className="text-[length:var(--fs-xs)] text-ink-3">{copy.dock}</span>
              <ProbBadge p={row.p_dock} />
            </div>
            {(row.exp_bikes !== null || note) && (
              <p className="col-span-3 text-[length:var(--fs-xs)] text-ink-2">
                {row.exp_bikes !== null && copy.expected(Math.round(row.exp_bikes), rangeText(row))}
                {note && <span className="ml-2 text-ink-3">{note}</span>}
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function ForecastTable({ forecasts, cityTz }: ForecastTableProps) {
  const isPhone = useMediaQuery('(max-width: 767.98px)');
  return (
    <div className="flex flex-col gap-2">
      {isPhone ? (
        <ForecastCards forecasts={forecasts} cityTz={cityTz} />
      ) : (
      <div className="overflow-x-auto">
        <table className="w-full text-left text-[length:var(--fs-sm)]">
          <caption className="visually-hidden">{COPY.station.forecastCaption}</caption>
          <thead>
            <tr className="border-b border-rule text-ink-3">
              <th className="py-2 pr-3 font-medium">In</th>
              <th className="py-2 pr-3 font-medium">At</th>
              <th className="py-2 pr-3 font-medium">Bike</th>
              <th className="py-2 pr-3 font-medium">Dock</th>
              <th className="py-2 pr-3 font-medium">Expected bikes</th>
              <th className="py-2 font-medium">Range</th>
            </tr>
          </thead>
          <tbody>
            {forecasts.map((row) => {
              const unavailable = row.p_bike === null && row.p_dock === null;
              const note = reasonText(row.reason);
              return (
                <tr
                  key={row.horizon}
                  data-testid="forecast-card"
                  className={`border-b border-rule ${unavailable ? 'text-ink-3' : ''}`}
                >
                  <td className="py-2 pr-3 tabular-nums">{horizonDurationLabel(row.horizon)}</td>
                  <td className="py-2 pr-3 tabular-nums">{fmtLocalTime(new Date(row.valid_at), cityTz)}</td>
                  <td className="py-2 pr-3">
                    <ProbBadge p={row.p_bike} />
                  </td>
                  <td className="py-2 pr-3">
                    <ProbBadge p={row.p_dock} />
                  </td>
                  <td className="py-2 pr-3 tabular-nums">
                    {row.exp_bikes === null ? '—' : Math.round(row.exp_bikes)}
                  </td>
                  <td className="py-2 tabular-nums">
                    {row.q10 === null || row.q90 === null
                      ? '—'
                      : `${Math.round(row.q10)}–${Math.round(row.q90)}`}
                    {note && <span className="ml-2 text-[length:var(--fs-xs)] text-ink-3">{note}</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      )}
      <p className="text-[length:var(--fs-xs)] text-ink-3">
        {COPY.station.modelLine(servingTierLabel(forecasts))}{' '}
        <Link to="/model" className="text-signal underline underline-offset-4">
          {COPY.station.howForecastsWork}
        </Link>
      </p>
    </div>
  );
}
