import type { ButtonHTMLAttributes } from 'react';
import { Icon, type IconName } from './Icon.js';

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: IconName;
  'aria-label': string;
  size?: number;
}

export function IconButton({ icon, size = 20, className = '', ...rest }: IconButtonProps) {
  return (
    <button
      type="button"
      className={`inline-flex items-center justify-center min-w-11 min-h-11 rounded-[var(--r-2)] text-ink-2 hover:bg-surface-2 hover:text-ink transition-colors duration-[var(--dur-state)] ${className}`}
      {...rest}
    >
      <Icon name={icon} size={size} />
    </button>
  );
}
