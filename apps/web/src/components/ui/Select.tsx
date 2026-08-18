/**
 * Native `<select>`, styled to match the other form controls. Not in
 * ui-spec.md §5's component contract table, but listed in §1's file tree and
 * needed by `CommuteForm` (alert lead / threshold pickers).
 */
export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  'aria-label'?: string;
  id?: string;
}

export function Select({ value, onChange, options, id, ...rest }: SelectProps) {
  return (
    <select
      id={id}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="w-full rounded-[var(--r-1)] border border-rule-strong bg-surface px-3 py-2 text-ink"
      {...rest}
    >
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}
