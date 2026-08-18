/**
 * Now/At… mode switch + native `<input type=time>`. ui-spec.md §4.1
 * `TripPlanner` "Leave" field, §5 component contract.
 */
import { SegmentedControl } from './SegmentedControl.js';
import { COPY } from '../../lib/constants.js';

export interface TimeInputProps {
  value: string | null;
  onChange: (value: string | null) => void;
  mode: 'now' | 'at';
  onModeChange?: (mode: 'now' | 'at') => void;
}

export function TimeInput({ value, onChange, mode, onModeChange }: TimeInputProps) {
  return (
    <div className="flex flex-col gap-2">
      <SegmentedControl
        ariaLabel="Leave"
        value={mode}
        onChange={(next) => onModeChange?.(next)}
        options={[
          { value: 'now', label: COPY.trip.leaveMode.now },
          { value: 'at', label: COPY.trip.leaveMode.at },
        ]}
      />
      {mode === 'at' && (
        <input
          type="time"
          value={value ?? ''}
          onChange={(event) => onChange(event.target.value || null)}
          className="w-full rounded-[var(--r-1)] border border-rule-strong bg-surface px-3 py-2 text-ink"
        />
      )}
    </div>
  );
}
