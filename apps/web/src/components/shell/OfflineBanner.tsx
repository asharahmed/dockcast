/**
 * "You're offline" strip under the header. ui-spec.md §4.0.
 */
import { useOnline } from '../../hooks/useOnline.js';
import { Icon } from '../ui/Icon.js';
import { COPY } from '../../lib/constants.js';

export function OfflineBanner() {
  const online = useOnline();
  if (online) return null;

  return (
    <div className="wash-serious flex items-center gap-2 px-[var(--gutter)] py-2 text-[length:var(--fs-sm)] text-ink" role="status">
      <Icon name="alert" size={16} />
      {COPY.offline}
    </div>
  );
}
