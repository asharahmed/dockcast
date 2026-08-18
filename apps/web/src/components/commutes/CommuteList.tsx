/**
 * ui-spec.md §4.4 `CommuteList`.
 */
import { CommuteRow } from './CommuteRow.js';
import { EmptyState } from '../ui/EmptyState.js';
import { COPY } from '../../lib/constants.js';
import type { CommuteWithOutlook } from '../../api/types.js';

export interface CommuteListProps {
  commutes: CommuteWithOutlook[];
  now: Date;
  highlightedId?: string | null;
  onNew: () => void;
  onEdit: (commute: CommuteWithOutlook) => void;
  onDelete: (id: string) => void;
}

export function CommuteList({
  commutes,
  now,
  highlightedId = null,
  onNew,
  onEdit,
  onDelete,
}: CommuteListProps) {
  if (commutes.length === 0) {
    return (
      <EmptyState
        icon="bike"
        title={COPY.commutes.empty.title}
        body={COPY.commutes.empty.body}
        action={{ label: COPY.commutes.newCommute, onClick: onNew }}
      />
    );
  }

  return (
    <ul className="flex flex-col divide-y divide-rule">
      {commutes.map((commute) => (
        <li key={commute.id}>
          <CommuteRow
            commute={commute}
            now={now}
            highlighted={commute.id === highlightedId}
            onEdit={() => onEdit(commute)}
            onDelete={() => onDelete(commute.id)}
          />
        </li>
      ))}
    </ul>
  );
}
