/**
 * `/model` for everyone who is not the operator (ui-spec.md §4.5, public view): what is
 * forecasting right now, how it has scored lately, and how it is calibrated. The api has
 * already trimmed the response (docs/api.md §4): `metrics` holds the serving tier and the
 * persistence baseline only, `versions` is empty, and the active models carry no gate or
 * validation detail, so nothing here needs hiding client-side.
 */
import { useState } from 'react';
import { format } from 'date-fns';
import { metricsTierForServing } from '@dockcast/shared';
import { Explainer } from './Explainer.js';
import { ReliabilityChart } from './ReliabilityChart.js';
import { TargetToggle } from '../forecast/TargetToggle.js';
import { EmptyState } from '../ui/EmptyState.js';
import { fmtRelative } from '../../lib/time.js';
import { COPY } from '../../lib/constants.js';
import type {
  ModelResponse,
  ModelMetricRow,
  MetricsTier,
  MetricsTarget,
  MetricName,
} from '../../api/types.js';
import type { Target } from '../../lib/prob.js';

/** The lead time the headline numbers quote: one hour ahead, pooled across all stations. */
const HEADLINE_HORIZON = 60;

export interface PublicModelViewProps {
  model: ModelResponse;
  now: Date;
}

function metricValue(
  rows: ModelMetricRow[],
  tier: MetricsTier,
  target: MetricsTarget,
  horizon: number,
  metric: MetricName,
): number | null {
  const row = rows.find(
    (r) =>
      r.window_days === 7 &&
      r.slice === 'all' &&
      r.tier === tier &&
      r.target === target &&
      r.horizon === horizon &&
      r.metric === metric,
  );
  return row?.value ?? null;
}

/** Signed percentage of error removed relative to the persistence baseline; null when either side is missing. */
function errorVsPersistence(serving: number | null, baseline: number | null): number | null {
  if (serving === null || baseline === null || baseline <= 0) return null;
  return Math.round((1 - serving / baseline) * 100);
}

function points(value: number | null): string | null {
  return value === null ? null : (value * 100).toFixed(1);
}

export function PublicModelView({ model, now }: PublicModelViewProps) {
  const [target, setTarget] = useState<Target>('bikes');
  const metricTarget: MetricsTarget = target === 'bikes' ? 'bike' : 'dock';
  const servingTier = model.predictor.serving_tier;
  const tier = metricsTierForServing(servingTier);
  const servingRows = tier ? model.metrics.filter((r) => r.tier === tier) : [];
  const scoredThrough = model.metrics.reduce<string | null>(
    (latest, r) => (latest === null || r.day > latest ? r.day : latest),
    null,
  );

  const copy = COPY.model.public;
  const cells: { label: string; value: string }[] = [
    { label: COPY.model.summary.servingNow, value: COPY.station.tierLabel[servingTier] },
    {
      label: copy.summary.learnedModel,
      value: model.active.gbm?.activated_at
        ? copy.summary.activeSince(format(new Date(model.active.gbm.activated_at), 'd MMM yyyy'))
        : copy.summary.notYet,
    },
    {
      label: COPY.model.summary.lastForecastRun,
      value: model.predictor.last_run_at ? fmtRelative(new Date(model.predictor.last_run_at), now) : '—',
    },
    {
      label: COPY.model.summary.dataSince,
      value: model.data_since ? format(new Date(model.data_since), 'd MMM yyyy') : '—',
    },
    { label: COPY.model.summary.stations, value: String(model.n_stations_active) },
    {
      label: copy.summary.scoredThrough,
      value: scoredThrough ? format(new Date(`${scoredThrough}T00:00:00`), 'd MMM yyyy') : '—',
    },
  ];

  const lines: string[] = [];
  if (tier) {
    const bikes = errorVsPersistence(
      metricValue(model.metrics, tier, 'bike', HEADLINE_HORIZON, 'brier'),
      metricValue(model.metrics, 'persistence', 'bike', HEADLINE_HORIZON, 'brier'),
    );
    const docks = errorVsPersistence(
      metricValue(model.metrics, tier, 'dock', HEADLINE_HORIZON, 'brier'),
      metricValue(model.metrics, 'persistence', 'dock', HEADLINE_HORIZON, 'brier'),
    );
    if (bikes !== null && docks !== null) {
      lines.push(copy.accuracy.vsPersistence(copy.accuracy.errorPhrase(bikes), copy.accuracy.errorPhrase(docks)));
    }
    const eceBike = points(metricValue(model.metrics, tier, 'bike', 0, 'ece'));
    const eceDock = points(metricValue(model.metrics, tier, 'dock', 0, 'ece'));
    if (eceBike !== null && eceDock !== null) lines.push(copy.accuracy.calibration(eceBike, eceDock));
    const mae = metricValue(model.metrics, tier, 'cnt', HEADLINE_HORIZON, 'mae');
    if (mae !== null) lines.push(copy.accuracy.mae(mae.toFixed(1)));
  }

  return (
    <>
      <dl className="grid grid-cols-1 gap-x-8 gap-y-4 divide-y divide-rule sm:grid-cols-3 sm:divide-y-0">
        {cells.map((cell) => (
          <div
            key={cell.label}
            className="flex flex-col gap-1 border-t border-rule pt-3 first:border-t-0 sm:border-t-0 sm:pt-0"
          >
            <dt className="text-[length:var(--fs-xs)] text-ink-3">{cell.label}</dt>
            <dd className="text-[length:var(--fs-md)] text-ink">{cell.value}</dd>
          </div>
        ))}
      </dl>

      <section className="flex max-w-[68ch] flex-col gap-3 border-t border-rule pt-[var(--sp-6)]">
        <h2 className="text-[length:var(--fs-lg)]">{copy.current.heading}</h2>
        <p className="text-ink-2">{copy.current[servingTier]}</p>
      </section>

      <section className="flex max-w-[68ch] flex-col gap-3 border-t border-rule pt-[var(--sp-6)]">
        <h2 className="text-[length:var(--fs-lg)]">{copy.accuracy.heading}</h2>
        {lines.length === 0 ? (
          <EmptyState icon="clock" title={copy.accuracy.empty} />
        ) : (
          <>
            <p className="text-ink-3 text-[length:var(--fs-sm)]">{copy.accuracy.intro}</p>
            <ul className="flex list-disc flex-col gap-2 pl-5 text-ink-2">
              {lines.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </>
        )}
      </section>

      {servingRows.length > 0 && (
        <div className="flex flex-col gap-6 border-t border-rule pt-[var(--sp-6)]">
          <div className="flex justify-end">
            <TargetToggle value={target} onChange={setTarget} />
          </div>
          <ReliabilityChart metrics={servingRows} target={metricTarget} slice="all" />
        </div>
      )}

      <div className="border-t border-rule pt-[var(--sp-6)]">
        <Explainer />
      </div>
    </>
  );
}
