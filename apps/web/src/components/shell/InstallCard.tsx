/**
 * "Get the app" card (About page, and the iOS alerts hint links to it). Chromium: a button
 * that replays the captured `beforeinstallprompt`. iOS Safari: the Share → Add to Home
 * Screen steps. Already installed: a one-line confirmation. Browsers that can't install:
 * nothing.
 */
import { Button } from '../ui/Button.js';
import { Icon } from '../ui/Icon.js';
import { useInstallState } from '../../hooks/useInstallState.js';
import { promptInstall } from '../../lib/install.js';
import { COPY } from '../../lib/constants.js';

export function InstallCard() {
  const state = useInstallState();
  const copy = COPY.pwa.install;

  if (state === 'unavailable') return null;

  if (state === 'installed') {
    return (
      <p className="flex items-center gap-2 text-[length:var(--fs-sm)] text-ink-2">
        <Icon name="check" size={16} />
        {copy.installed}
      </p>
    );
  }

  return (
    <section
      id="install"
      aria-labelledby="install-heading"
      className="flex flex-col gap-3 rounded-[var(--r-2)] border border-rule bg-surface p-[var(--sp-4)]"
    >
      <div className="flex items-center gap-3">
        <img src="/icons/icon-192.png" alt="" width={40} height={40} className="rounded-[10px]" />
        <h2 id="install-heading" className="text-[length:var(--fs-lg)]">
          {copy.heading}
        </h2>
      </div>
      <p className="text-ink-2">{copy.body}</p>
      {state === 'prompt' ? (
        <div>
          <Button type="button" icon="install" onClick={() => void promptInstall()}>
            {copy.button}
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-2 text-[length:var(--fs-sm)] text-ink-2">
          <p>{copy.iosLead}</p>
          <ol className="flex flex-col gap-1.5">
            {copy.iosSteps.map((step, i) => (
              <li key={step} className="flex items-center gap-2">
                <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface-2 text-[length:var(--fs-xs)] font-medium text-ink tabular-nums">
                  {i + 1}
                </span>
                {step}
                {i === 0 && <Icon name="ios-share" size={18} className="text-signal" />}
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}
