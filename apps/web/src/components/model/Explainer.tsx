/**
 * "Three tiers, always compared" explainer. ui-spec.md §4.5 item 3.
 */
import { COPY } from '../../lib/constants.js';

export function Explainer() {
  return (
    <div className="flex max-w-[68ch] flex-col gap-3">
      <h2 className="text-[length:var(--fs-lg)]">{COPY.model.explainer.heading}</h2>
      <p className="text-ink-2">
        <strong className="text-ink">{COPY.model.explainer.persistence.name}:</strong>{' '}
        {COPY.model.explainer.persistence.body}
      </p>
      <p className="text-ink-2">
        <strong className="text-ink">{COPY.model.explainer.flow.name}:</strong>{' '}
        {COPY.model.explainer.flow.body}
      </p>
      <p className="text-ink-2">
        <strong className="text-ink">{COPY.model.explainer.learned.name}:</strong>{' '}
        {COPY.model.explainer.learned.body}
      </p>
      <p className="text-ink-3">{COPY.model.explainer.shadow}</p>
    </div>
  );
}
