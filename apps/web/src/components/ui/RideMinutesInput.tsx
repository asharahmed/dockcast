/**
 * Ride-time minutes for `TripPlanner` and `CommuteForm` (ui-spec.md §4.1, §4.4). Shows the
 * auto estimate until the user types a value, then offers Reset. Takes the `id` and
 * `aria-describedby` that `Field` injects and puts them on the number input itself, so the
 * label and hint belong to the control and not to a wrapper.
 */
import { COPY } from '../../lib/constants.js';

export interface RideMinutesInputProps {
  id?: string;
  'aria-describedby'?: string;
  auto: boolean;
  autoValue: number | null;
  value: number | null;
  onChange: (value: number | null) => void;
  onReset: () => void;
}

export function RideMinutesInput({
  id,
  'aria-describedby': describedBy,
  auto,
  autoValue,
  value,
  onChange,
  onReset,
}: RideMinutesInputProps) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex min-h-11 w-32 items-center rounded-[var(--r-1)] border border-rule-strong bg-surface pr-3 focus-within:outline focus-within:outline-2 focus-within:outline-[var(--focus)]">
        <input
          id={id}
          aria-describedby={describedBy}
          type="number"
          inputMode="numeric"
          min={1}
          max={180}
          placeholder={COPY.trip.ridePlaceholder}
          value={auto ? (autoValue ?? '') : (value ?? '')}
          onChange={(event) => onChange(event.target.value === '' ? null : Number(event.target.value))}
          className="w-full min-w-0 self-stretch bg-transparent px-3 text-ink outline-none placeholder:text-ink-3"
        />
        <span aria-hidden="true" className="text-[length:var(--fs-sm)] text-ink-3">
          {COPY.trip.rideUnit}
        </span>
      </div>
      {!auto && (
        <button
          type="button"
          onClick={onReset}
          className="inline-flex min-h-11 items-center text-[length:var(--fs-sm)] text-signal underline underline-offset-4"
        >
          {COPY.trip.rideReset}
        </button>
      )}
    </div>
  );
}
