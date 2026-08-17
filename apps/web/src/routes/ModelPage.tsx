/**
 * `/model` — placeholder. ui-spec.md §4.5 ships in WP-10.
 */
import { useDocumentTitle } from '../hooks/useDocumentTitle.js';

export default function ModelPage() {
  useDocumentTitle('Model quality · DockCast');
  return (
    <div className="mx-auto max-w-[1100px] px-[var(--gutter)] py-[var(--sp-8)]">
      <h1 className="text-[length:var(--fs-2xl)]">How good are the forecasts?</h1>
      <p className="mt-4 text-ink-2">Coming in WP-10.</p>
    </div>
  );
}
