/**
 * Bikes | Docks segmented radiogroup. ui-spec.md §4.1, §5.
 */
import { SegmentedControl } from '../ui/SegmentedControl.js';
import type { Target } from '../../lib/prob.js';

export type { Target };

export interface TargetToggleProps {
  value: Target;
  onChange: (value: Target) => void;
}

export function TargetToggle({ value, onChange }: TargetToggleProps) {
  return (
    <SegmentedControl
      ariaLabel="Bikes or docks"
      value={value}
      onChange={onChange}
      options={[
        { value: 'bikes', label: 'Bikes', icon: 'bike' },
        { value: 'docks', label: 'Docks', icon: 'dock' },
      ]}
    />
  );
}
