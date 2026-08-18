/**
 * Inline delete/destructive confirmation that replaces the trigger area —
 * never a native `confirm()`. ui-spec.md §0 ("Never... native dialogs"), §5
 * component contract, §4.4 (`CommuteRow` delete).
 */
import { useEffect, useRef, type KeyboardEvent } from 'react';
import { Button } from './Button.js';

export interface InlineConfirmProps {
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  danger?: boolean;
}

export function InlineConfirm({
  message,
  confirmLabel,
  onConfirm,
  onCancel,
  danger = false,
}: InlineConfirmProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      onCancel();
    }
  }

  return (
    <div
      role="group"
      aria-label={message}
      onKeyDown={onKeyDown}
      className="flex flex-wrap items-center gap-3"
    >
      <p className="text-[length:var(--fs-sm)] text-ink">{message}</p>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant={danger ? 'primary' : 'secondary'}
          onClick={onConfirm}
          className={danger ? 'bg-st-critical text-signal-ink hover:opacity-90' : ''}
        >
          {confirmLabel}
        </Button>
        <button
          ref={cancelRef}
          type="button"
          onClick={onCancel}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-[var(--r-2)] px-4 py-2.5 text-[length:var(--fs-sm)] font-medium text-signal transition-opacity duration-[var(--dur-state)] ease-[var(--ease-out)] hover:bg-surface-2"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
