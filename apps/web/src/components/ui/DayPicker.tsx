/**
 * Seven toggle chips (`Mo Tu We Th Fr Sa Su`, values `0=Mon..6=Sun`).
 * ui-spec.md §4.4 `CommuteForm`, §5 component contract.
 */
import { useRef, type KeyboardEvent } from 'react';

export interface DayPickerProps {
  value: number[];
  onChange: (value: number[]) => void;
}

const DAYS = [
  { value: 0, label: 'Mo', full: 'Monday' },
  { value: 1, label: 'Tu', full: 'Tuesday' },
  { value: 2, label: 'We', full: 'Wednesday' },
  { value: 3, label: 'Th', full: 'Thursday' },
  { value: 4, label: 'Fr', full: 'Friday' },
  { value: 5, label: 'Sa', full: 'Saturday' },
  { value: 6, label: 'Su', full: 'Sunday' },
];

export function DayPicker({ value, onChange }: DayPickerProps) {
  const refs = useRef<Record<number, HTMLButtonElement | null>>({});

  function toggle(day: number) {
    if (value.includes(day)) {
      onChange(value.filter((d) => d !== day).sort((a, b) => a - b));
    } else {
      onChange([...value, day].sort((a, b) => a - b));
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let nextIndex: number | null = null;
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % DAYS.length;
    else if (event.key === 'ArrowLeft') nextIndex = (index - 1 + DAYS.length) % DAYS.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = DAYS.length - 1;
    if (nextIndex !== null) {
      event.preventDefault();
      const day = DAYS[nextIndex];
      if (day) refs.current[day.value]?.focus();
    }
  }

  return (
    <div role="group" aria-label="Days" className="flex flex-wrap gap-2">
      {DAYS.map((day, index) => {
        const selected = value.includes(day.value);
        return (
          <button
            key={day.value}
            ref={(el) => {
              refs.current[day.value] = el;
            }}
            type="button"
            aria-pressed={selected}
            aria-label={day.full}
            onClick={() => toggle(day.value)}
            onKeyDown={(event) => onKeyDown(event, index)}
            className={`inline-flex min-h-11 min-w-11 items-center justify-center rounded-[var(--r-1)] text-[length:var(--fs-sm)] font-medium transition-colors duration-[var(--dur-state)] ${
              selected
                ? 'bg-signal-wash text-signal'
                : 'border border-rule-strong text-ink-2 hover:bg-surface-2'
            }`}
          >
            {day.label}
          </button>
        );
      })}
    </div>
  );
}
