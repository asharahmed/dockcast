import type { ReactNode } from 'react';
import { Icon, type IconName } from './Icon.js';

export interface ChipProps {
  children: ReactNode;
  tone?: 'neutral' | 'good' | 'warn' | 'serious' | 'critical';
  icon?: IconName;
  className?: string;
}

const TONE_CLASS: Record<NonNullable<ChipProps['tone']>, string> = {
  neutral: 'bg-surface-2 text-ink-2',
  good: 'wash-good text-[color:var(--st-good-text)]',
  warn: 'wash-warn text-ink',
  serious: 'wash-serious text-ink',
  critical: 'wash-critical text-[color:var(--st-critical-text)]',
};

export function Chip({ children, tone = 'neutral', icon, className = '' }: ChipProps) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-[var(--r-pill)] px-3 py-1 text-[length:var(--fs-xs)] font-medium ${TONE_CLASS[tone]} ${className}`}
    >
      {icon && <Icon name={icon} size={14} />}
      {children}
    </span>
  );
}
