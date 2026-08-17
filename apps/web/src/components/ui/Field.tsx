/**
 * Label + input + hint/error wiring. ui-spec.md §5 component contract.
 */
import type { ReactElement, ReactNode } from 'react';
import { cloneElement, isValidElement, useId } from 'react';
import { Icon } from './Icon.js';

export interface FieldProps {
  label: string;
  hint?: string;
  error?: string;
  children: ReactElement<{ id?: string; 'aria-describedby'?: string }>;
}

export function Field({ label, hint, error, children }: FieldProps) {
  const inputId = useId();
  const hintId = useId();
  const errorId = useId();
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ');

  const control = isValidElement(children)
    ? cloneElement(children, {
        id: inputId,
        'aria-describedby': describedBy || undefined,
      })
    : children;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={inputId} className="text-[length:var(--fs-sm)] font-medium text-ink">
        {label}
      </label>
      {control as ReactNode}
      {hint && !error && (
        <p id={hintId} className="text-[length:var(--fs-xs)] text-ink-3">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="flex items-center gap-1 text-[length:var(--fs-xs)] text-st-critical">
          <Icon name="alert" size={14} />
          {error}
        </p>
      )}
    </div>
  );
}
