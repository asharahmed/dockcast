/**
 * `/trip` — placeholder. ui-spec.md §4.3 ships in WP-10.
 */
import { useDocumentTitle } from '../hooks/useDocumentTitle.js';

export default function TripPage() {
  useDocumentTitle('Trip check · DockCast');
  return (
    <div className="mx-auto max-w-[720px] px-[var(--gutter)] py-[var(--sp-8)]">
      <h1 className="text-[length:var(--fs-2xl)]">Trip check</h1>
      <p className="mt-4 text-ink-2">Coming in WP-10.</p>
    </div>
  );
}
