/**
 * `/model` — public model quality page. ui-spec.md §4.5.
 */
import { useState } from 'react';
import { useCities, useModel } from '../api/queries.js';
import { useCity } from '../hooks/useCity.js';
import { useNow } from '../hooks/useNow.js';
import { useDocumentTitle } from '../hooks/useDocumentTitle.js';
import { ModelSummary } from '../components/model/ModelSummary.js';
import { Explainer } from '../components/model/Explainer.js';
import { BrierChart } from '../components/model/BrierChart.js';
import { MaeChart } from '../components/model/MaeChart.js';
import { ReliabilityChart } from '../components/model/ReliabilityChart.js';
import { VersionsTable } from '../components/model/VersionsTable.js';
import { SegmentedControl } from '../components/ui/SegmentedControl.js';
import { TargetToggle } from '../components/forecast/TargetToggle.js';
import { EmptyState } from '../components/ui/EmptyState.js';
import { Skeleton } from '../components/ui/Skeleton.js';
import { COPY } from '../lib/constants.js';
import type { Target } from '../lib/prob.js';

const REPO_URL = (import.meta.env.VITE_REPO_URL as string | undefined) ?? '';

export default function ModelPage() {
  useDocumentTitle('Model quality · DockCast');
  const now = useNow();
  const { data: citiesData } = useCities();
  const cities = citiesData?.cities ?? [];
  const [slug] = useCity(cities[0]?.slug);
  const city = cities.find((c) => c.slug === slug) ?? cities[0];
  const modelQuery = useModel(city?.slug);

  const [target, setTarget] = useState<Target>('bikes');
  const [slice, setSlice] = useState<'all' | 'at_risk'>('all');

  if (modelQuery.isLoading || !modelQuery.data) {
    return (
      <div className="mx-auto flex max-w-[1100px] flex-col gap-8 px-[var(--gutter)] py-[var(--sp-8)]">
        <Skeleton height={40} width={320} />
        <Skeleton height={120} />
        <Skeleton height={300} />
      </div>
    );
  }

  if (modelQuery.isError) {
    return (
      <div className="mx-auto max-w-[1100px] px-[var(--gutter)] py-[var(--sp-8)]">
        <h1 className="text-[length:var(--fs-2xl)]">{COPY.model.title}</h1>
        <EmptyState
          icon="alert"
          title={COPY.model.couldntLoad}
          action={{ label: COPY.map.retry, onClick: () => modelQuery.refetch() }}
        />
      </div>
    );
  }

  const model = modelQuery.data;
  const metricTarget = target === 'bikes' ? 'bike' : 'dock';

  return (
    <div className="mx-auto flex max-w-[1100px] flex-col gap-[var(--sp-8)] px-[var(--gutter)] py-[var(--sp-8)]">
      <div className="flex max-w-[68ch] flex-col gap-3">
        <h1 className="text-[length:var(--fs-2xl)]">{COPY.model.title}</h1>
        <p className="text-ink-2">{COPY.model.intro}</p>
      </div>

      <ModelSummary model={model} now={now} />

      <Explainer />

      <div className="flex flex-col gap-6 border-t border-rule pt-[var(--sp-6)]">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <SegmentedControl
            ariaLabel="Slice"
            value={slice}
            onChange={setSlice}
            options={[
              { value: 'all', label: COPY.model.sliceToggle.all },
              { value: 'at_risk', label: COPY.model.sliceToggle.atRisk },
            ]}
          />
          <TargetToggle value={target} onChange={setTarget} />
        </div>

        {model.metrics.length === 0 ? (
          <EmptyState icon="clock" title={COPY.model.charts.empty} />
        ) : (
          <>
            <BrierChart metrics={model.metrics} target={metricTarget} slice={slice} />
            <MaeChart metrics={model.metrics} slice={slice} />
            <ReliabilityChart metrics={model.metrics} target={metricTarget} slice={slice} />
          </>
        )}
      </div>

      <div className="border-t border-rule pt-[var(--sp-6)]">
        <VersionsTable versions={model.versions} now={now} />
      </div>

      <p className="max-w-[68ch] text-[length:var(--fs-sm)] text-ink-3">
        {COPY.model.footnote}{' '}
        {REPO_URL ? (
          <a
            href={`${REPO_URL}/blob/main/docs/ml-spec.md`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-signal underline underline-offset-4"
          >
            {COPY.model.footnoteLinkLabel}
          </a>
        ) : (
          <span>{COPY.model.footnoteLinkLabel}</span>
        )}
      </p>
    </div>
  );
}
