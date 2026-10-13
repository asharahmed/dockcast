/**
 * `/model` for the operator (ui-spec.md §4.5, operator view): the fact grid, the tier
 * explainer, every chart across every tier and slice, and the version history with its
 * gate drill-down. Rendered only when the api said `viewer.is_admin` (docs/api.md §4).
 */
import { useState } from 'react';
import { ModelSummary } from './ModelSummary.js';
import { Explainer } from './Explainer.js';
import { BrierChart } from './BrierChart.js';
import { MaeChart } from './MaeChart.js';
import { ReliabilityChart } from './ReliabilityChart.js';
import { VersionsTable } from './VersionsTable.js';
import { SegmentedControl } from '../ui/SegmentedControl.js';
import { TargetToggle } from '../forecast/TargetToggle.js';
import { EmptyState } from '../ui/EmptyState.js';
import { COPY } from '../../lib/constants.js';
import type { ModelResponse } from '../../api/types.js';
import type { Target } from '../../lib/prob.js';

export interface DetailedModelViewProps {
  model: ModelResponse;
  now: Date;
}

export function DetailedModelView({ model, now }: DetailedModelViewProps) {
  const [target, setTarget] = useState<Target>('bikes');
  const [slice, setSlice] = useState<'all' | 'at_risk'>('all');
  const metricTarget = target === 'bikes' ? 'bike' : 'dock';

  return (
    <>
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
    </>
  );
}
