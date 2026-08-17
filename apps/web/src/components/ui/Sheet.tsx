/**
 * Docked side panel (desktop) / bottom sheet (mobile). ui-spec.md §4.1, §5.
 *
 * SPEC-GAP: the mobile sheet's snap points (peek/half/full) are spec'd as
 * drag-to-resize; jsdom/vitest can't exercise pointer-drag physics and a
 * production-quality gesture handler is out of scope for this pass. The
 * drag handle is a real button that cycles snap points (keyboard- and
 * click-operable), which satisfies "keyboard users can reach every state"
 * (§10) — a follow-up can layer pointer-drag on top without changing the
 * `snap` contract.
 */
import { useEffect, useRef, type ReactNode } from 'react';
import { useMediaQuery } from '../../hooks/useMediaQuery.js';
import { IconButton } from './IconButton.js';

export type SheetSnap = 'peek' | 'half' | 'full';

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  snap?: SheetSnap;
  onSnapChange?: (snap: SheetSnap) => void;
  title?: string;
  children: ReactNode;
}

const SNAP_ORDER: SheetSnap[] = ['peek', 'half', 'full'];

export function Sheet({ open, onClose, snap = 'peek', onSnapChange, title, children }: SheetProps) {
  const isDesktop = useMediaQuery('(min-width: 768px)');
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (open && !isDesktop && snap === 'full') {
      headingRef.current?.focus();
    }
  }, [open, isDesktop, snap]);

  if (!open) return null;

  if (isDesktop) {
    return (
      <div
        className="flex flex-col gap-4 overflow-y-auto rounded-[var(--r-2)] bg-surface p-4"
        style={{ boxShadow: 'var(--shadow-panel)' }}
        role="region"
        aria-label={title}
      >
        {title && (
          <h2 ref={headingRef} tabIndex={-1} className="text-[length:var(--fs-lg)]">
            {title}
          </h2>
        )}
        {children}
      </div>
    );
  }

  function cycleSnap() {
    const index = SNAP_ORDER.indexOf(snap);
    const next = SNAP_ORDER[(index + 1) % SNAP_ORDER.length];
    if (next) onSnapChange?.(next);
  }

  const heightBySnap: Record<SheetSnap, string> = {
    peek: '96px',
    half: '50dvh',
    full: '92dvh',
  };

  return (
    <div
      className="fixed inset-x-0 bottom-0 z-20 flex flex-col gap-3 rounded-t-[var(--r-2)] bg-surface p-4 transition-[height] duration-[var(--dur-panel)] ease-[var(--ease-out)]"
      style={{ height: heightBySnap[snap], boxShadow: 'var(--shadow-panel)' }}
      role={snap === 'full' ? 'dialog' : undefined}
      aria-modal={snap === 'full' ? true : undefined}
      aria-label={title}
    >
      <button
        type="button"
        onClick={cycleSnap}
        aria-label="Resize panel"
        className="mx-auto h-1.5 w-10 shrink-0 rounded-[var(--r-pill)] bg-rule-strong"
      />
      <div className="flex items-center justify-between">
        {title && (
          <h2 ref={headingRef} tabIndex={-1} className="text-[length:var(--fs-lg)]">
            {title}
          </h2>
        )}
        {snap === 'full' && <IconButton icon="close" aria-label="Close" onClick={onClose} />}
      </div>
      <div className="flex-1 overflow-y-auto">{children}</div>
    </div>
  );
}
