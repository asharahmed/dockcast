/**
 * ui-spec.md §4.4 `OutlookChip`.
 */
import { useNavigate } from 'react-router';
import { localDateString } from '@dockcast/shared';
import { VerdictChip } from '../forecast/VerdictChip.js';
import { fmtLocalTime } from '../../lib/time.js';
import { fmtPct } from '../../lib/prob.js';
import { COPY } from '../../lib/constants.js';
import type { CommuteOutlook } from '../../api/types.js';

export interface OutlookChipProps {
  outlook: CommuteOutlook;
  originId: number;
  destId: number;
  rideMinutes: number;
  cityTz: string;
  now: Date;
}

export function OutlookChip({
  outlook,
  originId,
  destId,
  rideMinutes,
  cityTz,
  now,
}: OutlookChipProps) {
  const navigate = useNavigate();

  let line: string;
  if (outlook.next_depart_at === null) {
    line = COPY.commutes.outlook.none;
  } else {
    const departDate = new Date(outlook.next_depart_at);
    const time = fmtLocalTime(departDate, cityTz);
    const todayStr = localDateString(now, cityTz);
    const departStr = localDateString(departDate, cityTz);
    const tomorrowStr = localDateString(new Date(now.getTime() + 24 * 60 * 60_000), cityTz);

    if (departStr === todayStr) {
      line = COPY.commutes.outlook.todayAt(time);
    } else if (departStr === tomorrowStr) {
      line = COPY.commutes.outlook.tomorrowAt(time);
    } else {
      line = COPY.commutes.outlook.otherAt(fmtLocalTime(departDate, cityTz, 'EEE h:mm a'));
    }

    if (outlook.origin.kind === 'typical' || outlook.dest.kind === 'typical') {
      line = `${line} ${COPY.commutes.outlook.typicalSuffix}`;
    }
  }

  const tooltip = COPY.commutes.outlook.tooltip(
    outlook.origin.p !== null ? fmtPct(outlook.origin.p) : '—',
    outlook.dest.p !== null ? fmtPct(outlook.dest.p) : '—',
  );

  function onClick() {
    if (!outlook.next_depart_at) return;
    navigate(
      `/trip?from=${originId}&to=${destId}&at=${encodeURIComponent(outlook.next_depart_at)}&ride=${rideMinutes}`,
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!outlook.next_depart_at}
      title={tooltip}
      className="flex flex-col items-end gap-1 text-right disabled:cursor-default"
    >
      <VerdictChip verdict={outlook.verdict} size="sm" />
      <span className="text-[length:var(--fs-xs)] text-ink-3">{line}</span>
    </button>
  );
}
