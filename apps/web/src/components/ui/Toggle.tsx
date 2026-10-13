/**
 * Labelled switch. Not in ui-spec.md §5's component contract table, but
 * listed in §1's file tree and needed by `CommuteForm` (`alert_enabled`).
 */
export interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}

export function Toggle({ checked, onChange, label }: ToggleProps) {
  return (
    <label className="flex min-h-11 cursor-pointer items-center gap-3">
      <span className="text-[length:var(--fs-sm)] font-medium text-ink">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative h-6 w-11 shrink-0 rounded-[var(--r-pill)] transition-colors duration-[var(--dur-state)] ${
          checked ? 'bg-signal' : 'bg-rule-strong'
        }`}
      >
        <span
          aria-hidden="true"
          className="absolute left-0 top-0.5 h-5 w-5 rounded-full bg-surface transition-transform duration-[var(--dur-state)]"
          style={{ transform: checked ? 'translateX(22px)' : 'translateX(2px)' }}
        />
      </button>
    </label>
  );
}
