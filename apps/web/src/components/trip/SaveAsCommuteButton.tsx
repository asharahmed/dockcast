/**
 * "Save as commute": signed-in → prefilled `/commutes?new=1&...`; signed-out
 * → `/login?next=<that url>`. ui-spec.md §4.1 `TripResult` footer actions.
 */
import { useNavigate } from 'react-router';
import { Button } from '../ui/Button.js';
import { useMe } from '../../api/queries.js';
import { fmtLocalTime } from '../../lib/time.js';
import { COPY } from '../../lib/constants.js';

export interface SaveAsCommuteButtonProps {
  originId: number;
  destId: number;
  departAt: Date;
  rideMinutes: number;
  cityTz: string;
}

export function SaveAsCommuteButton({
  originId,
  destId,
  departAt,
  rideMinutes,
  cityTz,
}: SaveAsCommuteButtonProps) {
  const navigate = useNavigate();
  const { data: me } = useMe();

  function onClick() {
    const hhmm = fmtLocalTime(departAt, cityTz, 'HH:mm');
    const target = `/commutes?new=1&from=${originId}&to=${destId}&at=${hhmm}&ride=${rideMinutes}`;
    navigate(me ? target : `/login?next=${encodeURIComponent(target)}`);
  }

  return (
    <Button type="button" variant="secondary" icon="save" onClick={onClick}>
      {COPY.trip.saveAsCommute}
    </Button>
  );
}
