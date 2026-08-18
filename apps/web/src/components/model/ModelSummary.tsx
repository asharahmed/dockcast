/**
 * 2×3 fact grid. ui-spec.md §4.5 `ModelSummary`.
 */
import { format } from 'date-fns';
import { fmtRelative } from '../../lib/time.js';
import { COPY } from '../../lib/constants.js';
import type { ModelResponse } from '../../api/types.js';

export interface ModelSummaryProps {
  model: ModelResponse;
  now: Date;
}

export function ModelSummary({ model, now }: ModelSummaryProps) {
  const activeLearned = model.active.gbm
    ? COPY.model.summary.activeModelLine(model.active.gbm.id, model.active.gbm.trained_for_date)
    : COPY.model.summary.noneYet;

  const cells: { label: string; value: string }[] = [
    { label: COPY.model.summary.servingNow, value: COPY.station.tierLabel[model.predictor.serving_tier] },
    { label: COPY.model.summary.activeLearnedModel, value: activeLearned },
    {
      label: COPY.model.summary.dataSince,
      value: model.data_since ? format(new Date(model.data_since), 'd MMM yyyy') : '—',
    },
    {
      label: COPY.model.summary.collectorUptime,
      value: model.collector.uptime_7d_pct !== null ? `${model.collector.uptime_7d_pct}%` : '—',
    },
    {
      label: COPY.model.summary.lastForecastRun,
      value: model.predictor.last_run_at ? fmtRelative(new Date(model.predictor.last_run_at), now) : '—',
    },
    { label: COPY.model.summary.stations, value: String(model.n_stations_active) },
  ];

  return (
    <dl className="grid grid-cols-1 gap-x-8 gap-y-4 divide-y divide-rule sm:grid-cols-3 sm:divide-y-0">
      {cells.map((cell) => (
        <div key={cell.label} className="flex flex-col gap-1 border-t border-rule pt-3 first:border-t-0 sm:border-t-0 sm:pt-0">
          <dt className="text-[length:var(--fs-xs)] text-ink-3">{cell.label}</dt>
          <dd className="text-[length:var(--fs-md)] text-ink">{cell.value}</dd>
        </div>
      ))}
    </dl>
  );
}
