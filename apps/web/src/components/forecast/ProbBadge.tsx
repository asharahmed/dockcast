/**
 * Percent + step swatch + optional label. ui-spec.md §5 component contract.
 */
import { fmtPct, probStep, STEP_LABELS } from '../../lib/prob.js';

export interface ProbBadgeProps {
  p: number | null;
  kind?: 'forecast' | 'typical' | 'unavailable';
  size?: 'sm' | 'md' | 'lg';
  label?: boolean;
}

const SWATCH_SIZE: Record<NonNullable<ProbBadgeProps['size']>, number> = {
  sm: 12,
  md: 16,
  lg: 20,
};

const TEXT_CLASS: Record<NonNullable<ProbBadgeProps['size']>, string> = {
  sm: 'text-[length:var(--fs-sm)]',
  md: 'text-[length:var(--fs-md)]',
  lg: 'font-[var(--font-display)] text-[length:var(--fs-2xl)] font-semibold',
};

const STEP_COLOR = ['var(--p0)', 'var(--p1)', 'var(--p2)', 'var(--p3)', 'var(--p4)'];

export function ProbBadge({ p, kind = 'forecast', size = 'md', label = false }: ProbBadgeProps) {
  const step = probStep(p);
  const hollow = kind !== 'forecast' || p === null;
  const swatchSize = SWATCH_SIZE[size];
  const stepLabel = STEP_LABELS[step] ?? 'No forecast';

  return (
    <span
      className="inline-flex items-center gap-2"
      aria-label={p === null ? `No forecast, ${stepLabel}` : `${fmtPct(p)} chance, ${stepLabel}`}
    >
      <span
        aria-hidden="true"
        className="inline-block shrink-0 rounded-full"
        style={{
          width: swatchSize,
          height: swatchSize,
          background: hollow ? 'none' : (STEP_COLOR[step] ?? 'none'),
          border: hollow ? '1.5px solid var(--p-none)' : undefined,
        }}
      />
      <span className={TEXT_CLASS[size]} aria-hidden="true">
        {p === null ? '—' : fmtPct(p)}
      </span>
      {label && (
        <span className="text-[length:var(--fs-sm)] text-ink-2" aria-hidden="true">
          {stepLabel}
        </span>
      )}
    </span>
  );
}
