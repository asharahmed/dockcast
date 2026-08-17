/**
 * Verdict pill: wash + hairline + icon + text. ui-spec.md §4.1, §5.
 */
import type { Verdict } from '../../api/types.js';
import { Icon, type IconName } from '../ui/Icon.js';
import { COPY } from '../../lib/constants.js';

export interface VerdictChipProps {
  verdict: Verdict;
  size?: 'sm' | 'md';
}

const VERDICT_TONE: Record<Verdict, string> = {
  good: 'wash-good text-[color:var(--st-good-text)]',
  risky: 'wash-warn text-ink',
  bad: 'wash-critical text-[color:var(--st-critical-text)]',
  unknown: 'bg-surface-2 text-ink-2',
};

const VERDICT_ICON: Record<Verdict, IconName> = {
  good: 'check',
  risky: 'alert',
  bad: 'cross',
  unknown: 'question',
};

export function VerdictChip({ verdict, size = 'md' }: VerdictChipProps) {
  return (
    <span
      role="status"
      className={`inline-flex items-center gap-1.5 rounded-[var(--r-pill)] font-medium ${VERDICT_TONE[verdict]} ${
        size === 'sm' ? 'px-2.5 py-1 text-[length:var(--fs-xs)]' : 'px-3 py-1.5 text-[length:var(--fs-sm)]'
      }`}
    >
      <Icon name={VERDICT_ICON[verdict]} size={size === 'sm' ? 14 : 16} />
      {COPY.verdict[verdict]}
    </span>
  );
}
