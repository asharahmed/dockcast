/**
 * ui-spec.md §4.4 `CommuteRow`.
 */
import { useState } from 'react';
import { InlineConfirm } from '../ui/InlineConfirm.js';
import { OutlookChip } from './OutlookChip.js';
import { COPY } from '../../lib/constants.js';
import { parseHHMM } from '../../lib/time.js';
import type { CommuteWithOutlook } from '../../api/types.js';

const DAY_ABBR = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function formatDays(days: number[]): string {
  const sorted = [...days].sort((a, b) => a - b);
  if (sorted.length === 7) return COPY.commutes.days.everyDay;
  if (sorted.length === 5 && sorted.every((d, i) => d === i)) return COPY.commutes.days.weekdays;
  return sorted.map((d) => DAY_ABBR[d]).join(', ');
}

/** 24 h `HH:MM` -> `h:mm a`, without needing a `Date`/timezone (it's already local wall-clock). */
function formatHHMM12h(hhmm: string): string {
  const { hour, minute } = parseHHMM(hhmm);
  const period = hour >= 12 ? 'PM' : 'AM';
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}:${String(minute).padStart(2, '0')} ${period}`;
}

export interface CommuteRowProps {
  commute: CommuteWithOutlook;
  now: Date;
  highlighted?: boolean;
  onEdit: () => void;
  onDelete: () => void;
}

export function CommuteRow({ commute, now, highlighted = false, onEdit, onDelete }: CommuteRowProps) {
  const [confirming, setConfirming] = useState(false);

  const scheduleLine = COPY.commutes.schedule(
    formatDays(commute.days_of_week),
    formatHHMM12h(commute.depart_local_time),
    commute.ride_minutes,
  );
  const alertsLine = COPY.commutes.alertsLine(
    commute.alert_enabled,
    commute.alert_lead_minutes,
    Math.round(commute.threshold * 100),
  );

  return (
    <div
      className={`flex flex-col gap-3 py-[var(--sp-4)] transition-colors ${highlighted ? 'bg-signal-wash' : ''}`}
      style={{ transitionDuration: highlighted ? '1200ms' : 'var(--dur-state)' }}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <p className="font-[var(--font-display)] text-[length:var(--fs-lg)] font-semibold text-ink">
            {commute.name}
          </p>
          <p className="text-[length:var(--fs-sm)] text-ink-2">{`${commute.origin.name} → ${commute.dest.name}`}</p>
          <p className="text-[length:var(--fs-sm)] text-ink-3">{scheduleLine}</p>
          <p className="text-[length:var(--fs-xs)] text-ink-3">{alertsLine}</p>
        </div>
        <OutlookChip
          outlook={commute.outlook}
          originId={commute.origin.id}
          destId={commute.dest.id}
          rideMinutes={commute.ride_minutes}
          cityTz={commute.city.tz}
          now={now}
        />
      </div>

      {confirming ? (
        <InlineConfirm
          message={COPY.commutes.deleteConfirm(commute.name)}
          confirmLabel={COPY.commutes.delete}
          onConfirm={onDelete}
          onCancel={() => setConfirming(false)}
          danger
        />
      ) : (
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={onEdit}
            className="text-[length:var(--fs-sm)] font-medium text-signal underline underline-offset-4"
          >
            {COPY.commutes.edit}
          </button>
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="text-[length:var(--fs-sm)] font-medium text-st-critical underline underline-offset-4"
          >
            {COPY.commutes.delete}
          </button>
        </div>
      )}
    </div>
  );
}
