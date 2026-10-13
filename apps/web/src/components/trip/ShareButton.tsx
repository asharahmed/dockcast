/**
 * Copies the shareable trip URL to the clipboard; falls back to a read-only
 * input when the Clipboard API is unavailable. ui-spec.md §4.1 `TripResult`
 * footer actions.
 */
import { useState } from 'react';
import { Button } from '../ui/Button.js';
import { useToast } from '../shell/Toasts.js';
import { COPY } from '../../lib/constants.js';

export function ShareButton({ url }: { url: string }) {
  const addToast = useToast();
  const [showFallback, setShowFallback] = useState(false);

  async function onClick() {
    if (!navigator.clipboard) {
      setShowFallback(true);
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      addToast(COPY.trip.shareCopied, 'good');
    } catch {
      setShowFallback(true);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <Button type="button" variant="ghost" icon="share" onClick={onClick}>
        {COPY.trip.share}
      </Button>
      {showFallback && (
        <input
          type="text"
          readOnly
          value={url}
          aria-label="Trip link"
          onFocus={(event) => event.currentTarget.select()}
          className="min-h-11 w-full rounded-[var(--r-1)] border border-rule-strong bg-surface px-3 py-2 text-ink"
        />
      )}
    </div>
  );
}
