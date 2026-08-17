/**
 * `/commutes` — placeholder. ui-spec.md §4.4 ships in WP-10.
 */
import { useDocumentTitle } from '../hooks/useDocumentTitle.js';

export default function CommutesPage() {
  useDocumentTitle('My commutes · DockCast');
  return (
    <div className="mx-auto max-w-[880px] px-[var(--gutter)] py-[var(--sp-8)]">
      <h1 className="text-[length:var(--fs-2xl)]">My commutes</h1>
      <p className="mt-4 text-ink-2">Coming in WP-10.</p>
    </div>
  );
}
