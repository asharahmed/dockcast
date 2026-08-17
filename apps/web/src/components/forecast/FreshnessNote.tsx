/**
 * "Forecasts are {n} min old" inline warning. ui-spec.md §4.1.
 */
import { Icon } from '../ui/Icon.js';
import { COPY } from '../../lib/constants.js';

export function FreshnessNote({ minutesOld }: { minutesOld: number }) {
  return (
    <p className="wash-warn flex items-center gap-2 rounded-[var(--r-1)] px-3 py-2 text-[length:var(--fs-sm)] text-ink">
      <Icon name="alert" size={16} />
      {COPY.map.stale(minutesOld)}
    </p>
  );
}
