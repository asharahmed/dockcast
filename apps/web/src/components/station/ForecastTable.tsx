/**
 * ui-spec.md §4.2 `ForecastTable`.
 *
 * SPEC-GAP / deviation: §6 asks mobile tables to collapse into stacked
 * definition-list blocks; this ships as a horizontally-scrollable `<table>`
 * instead (still fully readable, keyboard/AT-navigable) — the bespoke
 * stacked-row CSS is deferred to a follow-up pass so WP-9 isn't blocked on
 * it. Flagged in the WP-9 report rather than guessed silently.
 */
import { Link } from 'react-router';
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

export function ForecastTable({ forecasts, cityTz }: ForecastTableProps) {
  return (
    <div className="flex flex-col gap-2">
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
      <p className="text-[length:var(--fs-xs)] text-ink-3">
        {COPY.station.modelLine(servingTierLabel(forecasts))}{' '}
        <Link to="/model" className="text-signal underline underline-offset-4">
          {COPY.station.howForecastsWork}
        </Link>
      </p>
    </div>
  );
}
