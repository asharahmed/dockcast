/**
 * Roving-tabindex radiogroup. ui-spec.md §5 component contract.
 */
import { useRef } from 'react';
import { Icon, type IconName } from './Icon.js';

export interface SegmentedOption<V extends string> {
  value: V;
  label: string;
  icon?: IconName;
}

export interface SegmentedControlProps<V extends string> {
  options: SegmentedOption<V>[];
  value: V;
  onChange: (value: V) => void;
  ariaLabel: string;
}

export function SegmentedControl<V extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: SegmentedControlProps<V>) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});

  function onKeyDown(event: React.KeyboardEvent, index: number) {
    let nextIndex: number | null = null;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      nextIndex = (index + 1) % options.length;
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      nextIndex = (index - 1 + options.length) % options.length;
    } else if (event.key === 'Home') {
      nextIndex = 0;
    } else if (event.key === 'End') {
      nextIndex = options.length - 1;
    }
    if (nextIndex !== null) {
      event.preventDefault();
      const option = options[nextIndex];
      if (!option) return;
      onChange(option.value);
      refs.current[option.value]?.focus();
    }
  }

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className="inline-flex w-fit max-w-full self-start rounded-[var(--r-2)] border border-rule-strong bg-surface p-1"
    >
      {options.map((option, index) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            ref={(el) => {
              refs.current[option.value] = el;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(option.value)}
            onKeyDown={(e) => onKeyDown(e, index)}
            className={`inline-flex items-center gap-1.5 rounded-[var(--r-1)] px-3 py-1.5 text-[length:var(--fs-sm)] font-medium transition-colors duration-[var(--dur-state)] min-h-11 md:min-h-9 ${
              selected ? 'bg-signal-wash text-signal' : 'text-ink-2 hover:bg-surface-2'
            }`}
          >
            {option.icon && <Icon name={option.icon} size={16} />}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
