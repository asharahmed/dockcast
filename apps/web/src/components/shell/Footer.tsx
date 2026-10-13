/**
 * Site footer (non-map pages): tagline, theme control, health dot.
 * ui-spec.md §4.0.
 */
import { Link } from 'react-router';
import { useTheme } from '../../hooks/useTheme.js';
import { useHealth } from '../../api/queries.js';
import { SegmentedControl } from '../ui/SegmentedControl.js';
import { COPY } from '../../lib/constants.js';

export function Footer() {
  const [theme, setThemePref] = useTheme();
  const { data: health } = useHealth();
  const healthy = health?.ok ?? null;

  return (
    <footer className="flex flex-col gap-4 border-t border-rule px-[var(--gutter)] py-[var(--sp-5)] sm:flex-row sm:items-center sm:justify-between">
      <p className="flex flex-wrap items-center gap-x-4 text-[length:var(--fs-sm)] text-ink-2">
        <span>{COPY.shell.footerTagline}</span>
        <Link to="/privacy" className="inline-flex min-h-11 items-center underline underline-offset-4 hover:text-ink">
          {COPY.shell.privacy}
        </Link>
      </p>
      <div className="flex items-center gap-4">
        <SegmentedControl
          ariaLabel="Theme"
          value={theme}
          onChange={setThemePref}
          options={[
            { value: 'system', label: COPY.shell.theme.system, icon: 'monitor' },
            { value: 'light', label: COPY.shell.theme.light, icon: 'sun' },
            { value: 'dark', label: COPY.shell.theme.dark, icon: 'moon' },
          ]}
        />
        <span
          title={healthy ? COPY.shell.healthOk : COPY.shell.healthDown}
          aria-label={healthy ? COPY.shell.healthOk : COPY.shell.healthDown}
          className="inline-block h-2 w-2 rounded-full"
          style={{ background: healthy ? 'var(--st-good)' : 'var(--st-critical)' }}
        />
      </div>
    </footer>
  );
}
