/**
 * "A new version is ready" strip (ui-spec.md §8). Shown when a freshly deployed service
 * worker is waiting; Reload hands over to it (`applyUpdate`), Later hides the strip until
 * the next update is found. Sits above the tab bar on phones.
 */
import { useEffect, useState } from 'react';
import { SW_UPDATE_EVENT, applyUpdate, updateWaiting } from '../../lib/sw.js';
import { COPY } from '../../lib/constants.js';

export function UpdateBanner() {
  const [visible, setVisible] = useState(updateWaiting);

  useEffect(() => {
    const show = () => setVisible(true);
    window.addEventListener(SW_UPDATE_EVENT, show);
    return () => window.removeEventListener(SW_UPDATE_EVENT, show);
  }, []);

  if (!visible) return null;

  return (
    <div className="fixed inset-x-0 bottom-[calc(var(--tabbar-h)+var(--sp-3))] z-30 flex justify-center px-[var(--gutter)] md:bottom-[var(--sp-4)]">
      <div
        role="status"
        className="flex w-full max-w-[460px] items-center gap-3 rounded-[var(--r-2)] bg-surface py-2 pl-4 pr-2 text-[length:var(--fs-sm)] text-ink"
        style={{ boxShadow: 'var(--shadow-panel)', borderLeft: '3px solid var(--signal)' }}
      >
        <span className="flex-1">{COPY.pwa.updateReady}</span>
        <button
          type="button"
          onClick={() => setVisible(false)}
          className="min-h-11 rounded-[var(--r-1)] px-3 text-ink-2 hover:bg-surface-2"
        >
          {COPY.pwa.updateLater}
        </button>
        <button
          type="button"
          onClick={applyUpdate}
          className="min-h-11 rounded-[var(--r-1)] bg-signal px-4 font-medium text-signal-ink"
        >
          {COPY.pwa.updateReload}
        </button>
      </div>
    </div>
  );
}
