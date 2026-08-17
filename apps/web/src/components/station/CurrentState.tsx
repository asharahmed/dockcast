/**
 * ui-spec.md §4.2 `CurrentState`.
 */
import { Chip } from '../ui/Chip.js';
import { EmptyState } from '../ui/EmptyState.js';
import { COPY } from '../../lib/constants.js';
import { fmtRelative } from '../../lib/time.js';
import type { StationCurrent } from '../../api/types.js';

export interface CurrentStateProps {
  current: StationCurrent | null;
  now: Date;
}

export function CurrentState({ current, now }: CurrentStateProps) {
  if (!current) {
    return <EmptyState icon="alert" title={COPY.station.noCurrentData} />;
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-[var(--sp-7)]">
        <div>
          <p className="font-[var(--font-display)] text-[length:var(--fs-hero)] font-semibold leading-none">
            {current.bikes}
          </p>
          <p className="text-[length:var(--fs-sm)] text-ink-2">{COPY.station.bikesNow}</p>
        </div>
        <div>
          <p className="font-[var(--font-display)] text-[length:var(--fs-hero)] font-semibold leading-none">
            {current.docks}
          </p>
          <p className="text-[length:var(--fs-sm)] text-ink-2">{COPY.station.docksNow}</p>
        </div>
      </div>
      {current.ebikes !== null && (
        <p className="text-[length:var(--fs-sm)] text-ink-2">{COPY.station.ebikes(current.ebikes)}</p>
      )}
      {current.is_fresh ? (
        <p className="text-[length:var(--fs-sm)] text-ink-3">
          {COPY.station.liveReported(fmtRelative(new Date(current.last_reported), now))}
        </p>
      ) : (
        <Chip tone="serious" icon="alert">
          {COPY.station.notReportingLastSeen(fmtRelative(new Date(current.last_reported), now))}
        </Chip>
      )}
    </div>
  );
}
