/**
 * Docked side panel (desktop) / bottom sheet (mobile). ui-spec.md §4.1, §5.
 *
 * Mobile: the sheet sits directly above the tab bar (`--tabbar-h`). Its handle is a
 * full-width 44 px strip: swipe up/down on it to move one snap point (peek → half →
 * full and back), tap it to cycle, or activate it from the keyboard (§10: every
 * state reachable without a pointer). The snap moves on release rather than tracking
 * the finger, which keeps the `snap` contract unchanged.
 */
import { useEffect, useRef, type PointerEvent, type ReactNode } from 'react';
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

/** Vertical travel (px) on the handle that counts as a swipe rather than a tap. */
const SWIPE_PX = 24;

export function Sheet({ open, onClose, snap = 'peek', onSnapChange, title, children }: SheetProps) {
  const isDesktop = useMediaQuery('(min-width: 768px)');
  const headingRef = useRef<HTMLHeadingElement>(null);
  const dragStartY = useRef<number | null>(null);

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

  /** One snap point up (`+1`, taller) or down (`-1`), clamped at both ends. */
  function stepSnap(direction: 1 | -1) {
    const index = SNAP_ORDER.indexOf(snap);
    const next = SNAP_ORDER[Math.min(SNAP_ORDER.length - 1, Math.max(0, index + direction))];
    if (next && next !== snap) onSnapChange?.(next);
  }

  function onHandlePointerDown(event: PointerEvent<HTMLButtonElement>) {
    dragStartY.current = event.clientY;
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function onHandlePointerUp(event: PointerEvent<HTMLButtonElement>) {
    const start = dragStartY.current;
    dragStartY.current = null;
    if (start === null) return;
    const dy = event.clientY - start;
    if (Math.abs(dy) < SWIPE_PX) cycleSnap();
    else stepSnap(dy < 0 ? 1 : -1);
  }

  // Full leaves the header visible; the tab bar stays below the sheet at every snap.
  const heightBySnap: Record<SheetSnap, string> = {
    peek: '104px',
    half: '50dvh',
    full: 'calc(100dvh - var(--header-h) - var(--tabbar-h) - 8px)',
  };

  return (
    <div
      className="fixed inset-x-0 bottom-[var(--tabbar-h)] z-20 flex flex-col gap-3 rounded-t-[var(--r-2)] bg-surface px-4 pb-4 transition-[height] duration-[var(--dur-panel)] ease-[var(--ease-out)]"
      style={{ height: heightBySnap[snap], boxShadow: 'var(--shadow-panel)' }}
      role={snap === 'full' ? 'dialog' : undefined}
      aria-modal={snap === 'full' ? true : undefined}
      aria-label={title}
    >
      <button
        type="button"
        aria-label="Resize panel"
        onPointerDown={onHandlePointerDown}
        onPointerUp={onHandlePointerUp}
        onPointerCancel={() => {
          dragStartY.current = null;
        }}
        // Pointer taps and swipes are handled on pointer-up; `detail === 0` is a
        // keyboard (or assistive-tech) activation, which has no pointer events.
        onClick={(event) => {
          if (event.detail === 0) cycleSnap();
        }}
        className="flex h-11 w-full shrink-0 touch-none items-center justify-center"
      >
        <span aria-hidden="true" className="h-1.5 w-10 rounded-[var(--r-pill)] bg-rule-strong" />
      </button>
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
