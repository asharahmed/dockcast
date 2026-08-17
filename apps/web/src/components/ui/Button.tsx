import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Icon, type IconName } from './Icon.js';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost';
  icon?: IconName;
  children: ReactNode;
}

const VARIANT_CLASS: Record<NonNullable<ButtonProps['variant']>, string> = {
  primary: 'bg-signal text-signal-ink hover:opacity-90',
  secondary:
    'bg-transparent text-ink border border-rule-strong hover:bg-surface-2',
  ghost: 'bg-transparent text-signal hover:bg-surface-2',
};

export function Button({
  variant = 'primary',
  icon,
  children,
  className = '',
  ...rest
}: ButtonProps) {
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 rounded-[var(--r-2)] px-4 py-2.5 text-[length:var(--fs-sm)] font-medium transition-opacity duration-[var(--dur-state)] ease-[var(--ease-out)] disabled:opacity-50 disabled:pointer-events-none min-h-11 ${VARIANT_CLASS[variant]} ${className}`}
      {...rest}
    >
      {icon && <Icon name={icon} size={18} />}
      {children}
    </button>
  );
}
