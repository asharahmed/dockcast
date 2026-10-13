/**
 * Model versions table with gate drill-down. ui-spec.md §4.5 `VersionsTable`. Below
 * 768 px (§6) each version is a tappable block instead of a seven-column row.
 */
import { Fragment, useState } from 'react';
import { useMediaQuery } from '../../hooks/useMediaQuery.js';
import { Chip } from '../ui/Chip.js';
import { EmptyState } from '../ui/EmptyState.js';
import { useModelVersion } from '../../api/queries.js';
import { fmtRelative } from '../../lib/time.js';
import { COPY } from '../../lib/constants.js';
import type { ModelVersionSummary, ModelVersionStatus } from '../../api/types.js';

function StatusChip({ status }: { status: ModelVersionStatus }) {
  switch (status) {
    case 'active':
      return (
        <Chip tone="good" icon="check">
          {status}
        </Chip>
      );
    case 'shadow':
      return <Chip tone="warn">{status}</Chip>;
    case 'rejected':
    case 'failed':
      return (
        <Chip tone="critical" icon="cross">
          {status}
        </Chip>
      );
    default:
      return <Chip tone="neutral">{status}</Chip>;
  }
}

function VersionDetail({ id }: { id: number }) {
  const detailQuery = useModelVersion(id);
  const version = detailQuery.data?.version;

  if (detailQuery.isLoading || !detailQuery.data) {
    return <p className="py-3 text-[length:var(--fs-sm)] text-ink-3">…</p>;
  }

  return (
    <div className="flex flex-col gap-3 py-3">
      {version?.gate && (
        <div className="flex flex-col gap-1">
          {version.gate.checks.map((check) => (
            <p key={check.name} className="text-[length:var(--fs-xs)] text-ink-2">
              {`${check.name} ${check.value ?? '—'} vs ${check.threshold ?? '—'} ${check.ok ? '✓' : '✗'}`}
            </p>
          ))}
        </div>
      )}
      {detailQuery.data.eval.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[length:var(--fs-xs)]">
            <thead>
              <tr className="border-b border-rule text-ink-3">
                <th className="py-1 pr-3 font-medium">Split</th>
                <th className="py-1 pr-3 font-medium">Target</th>
                <th className="py-1 pr-3 font-medium">Horizon</th>
                <th className="py-1 pr-3 font-medium">Slice</th>
                <th className="py-1 pr-3 font-medium">Metric</th>
                <th className="py-1 font-medium">Value</th>
              </tr>
            </thead>
            <tbody>
              {detailQuery.data.eval.map((row, i) => (
                <tr key={i} className="border-b border-rule">
                  <td className="py-1 pr-3">{row.split}</td>
                  <td className="py-1 pr-3">{row.target}</td>
                  <td className="py-1 pr-3 tabular-nums">{row.horizon}</td>
                  <td className="py-1 pr-3">{row.slice}</td>
                  <td className="py-1 pr-3">{row.metric}</td>
                  <td className="py-1 tabular-nums">{row.value ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export interface VersionsTableProps {
  versions: ModelVersionSummary[];
  now: Date;
}

function valBrier(v: ModelVersionSummary): string {
  return v.metrics_val?.brier
    ? `${v.metrics_val.brier.bike.toFixed(3)} / ${v.metrics_val.brier.dock.toFixed(3)}`
    : '—';
}

function GateChip({ v }: { v: ModelVersionSummary }) {
  if (!v.gate) return <>—</>;
  return (
    <Chip tone={v.gate.passed ? 'good' : 'critical'}>
      {v.gate.passed ? COPY.model.versions.gatePassed : COPY.model.versions.gateFailed}
    </Chip>
  );
}

function VersionCards({ versions, now }: VersionsTableProps) {
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const cols = COPY.model.versions.columns;
  return (
    <ul aria-label={COPY.model.versions.heading} className="flex flex-col divide-y divide-rule border-y border-rule">
      {versions.slice(0, 30).map((v) => {
        const expanded = expandedId === v.id;
        return (
          <li key={v.id}>
            <button
              type="button"
              aria-expanded={expanded}
              onClick={() => setExpandedId(expanded ? null : v.id)}
              className="flex w-full flex-col gap-1.5 py-3 text-left text-[length:var(--fs-sm)]"
            >
              <span className="flex items-center justify-between gap-3">
                <span className="font-medium tabular-nums">
                  #{v.id} · {v.tier} · {v.trained_for_date}
                </span>
                <StatusChip status={v.status} />
              </span>
              <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[length:var(--fs-xs)] text-ink-2">
                <span className="tabular-nums">
                  {cols.valBrier}: {valBrier(v)}
                </span>
                <span className="inline-flex items-center gap-1">
                  {cols.gate}: <GateChip v={v} />
                </span>
                <span className="text-ink-3">{fmtRelative(new Date(v.created_at), now)}</span>
              </span>
            </button>
            {expanded && <VersionDetail id={v.id} />}
          </li>
        );
      })}
    </ul>
  );
}

export function VersionsTable({ versions, now }: VersionsTableProps) {
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const isPhone = useMediaQuery('(max-width: 767.98px)');

  if (versions.length === 0) {
    return <EmptyState icon="clock" title={COPY.model.versions.empty} />;
  }

  if (isPhone) {
    return (
      <div className="flex flex-col gap-3">
        <h2 className="text-[length:var(--fs-lg)]">{COPY.model.versions.heading}</h2>
        <VersionCards versions={versions} now={now} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-[length:var(--fs-lg)]">{COPY.model.versions.heading}</h2>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-[length:var(--fs-sm)]">
          <caption className="visually-hidden">{COPY.model.versions.heading}</caption>
          <thead>
            <tr className="border-b border-rule text-ink-3">
              <th className="py-2 pr-3 font-medium">{COPY.model.versions.columns.id}</th>
              <th className="py-2 pr-3 font-medium">{COPY.model.versions.columns.tier}</th>
              <th className="py-2 pr-3 font-medium">{COPY.model.versions.columns.trainedFor}</th>
              <th className="py-2 pr-3 font-medium">{COPY.model.versions.columns.status}</th>
              <th className="py-2 pr-3 font-medium">{COPY.model.versions.columns.valBrier}</th>
              <th className="py-2 pr-3 font-medium">{COPY.model.versions.columns.gate}</th>
              <th className="py-2 font-medium">{COPY.model.versions.columns.created}</th>
            </tr>
          </thead>
          <tbody>
            {versions.slice(0, 30).map((v) => {
              const expanded = expandedId === v.id;
              return (
                <Fragment key={v.id}>
                  <tr
                    onClick={() => setExpandedId(expanded ? null : v.id)}
                    className="cursor-pointer border-b border-rule hover:bg-surface-2"
                  >
                    <td className="py-2 pr-3 tabular-nums">{v.id}</td>
                    <td className="py-2 pr-3">{v.tier}</td>
                    <td className="py-2 pr-3 tabular-nums">{v.trained_for_date}</td>
                    <td className="py-2 pr-3">
                      <StatusChip status={v.status} />
                    </td>
                    <td className="py-2 pr-3 tabular-nums">
                      {v.metrics_val?.brier
                        ? `${v.metrics_val.brier.bike.toFixed(3)} / ${v.metrics_val.brier.dock.toFixed(3)}`
                        : '—'}
                    </td>
                    <td className="py-2 pr-3">
                      {v.gate ? (
                        <Chip tone={v.gate.passed ? 'good' : 'critical'}>
                          {v.gate.passed ? COPY.model.versions.gatePassed : COPY.model.versions.gateFailed}
                        </Chip>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="py-2 tabular-nums">{fmtRelative(new Date(v.created_at), now)}</td>
                  </tr>
                  {expanded && (
                    <tr className="border-b border-rule">
                      <td colSpan={7}>
                        <VersionDetail id={v.id} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
