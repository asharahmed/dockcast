/**
 * Mobile bottom tab bar (<768 px). ui-spec.md §4.0.
 *
 * SPEC-GAP: the spec's "More→About/Sign in" tab implies a combined
 * destination not present in the route table (§4 lists no `/more` route).
 * The header keeps auth visible on mobile ("header keeps logo + auth" —
 * §4.0), so `More` links straight to `/about`, the nearest existing route.
 */
import { NavLink } from 'react-router';
import { Icon, type IconName } from '../ui/Icon.js';
import { COPY } from '../../lib/constants.js';

const TAB_ITEMS: { to: string; label: string; icon: IconName; end?: boolean }[] = [
  { to: '/', label: COPY.shell.nav.map, icon: 'map', end: true },
  { to: '/commutes', label: COPY.shell.nav.commutes, icon: 'bike' },
  { to: '/model', label: COPY.shell.nav.model, icon: 'clock' },
  { to: '/about', label: COPY.shell.nav.more, icon: 'question' },
];

export function Nav() {
  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-20 flex h-[var(--tabbar-h)] items-stretch justify-around border-t border-rule bg-surface pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      {TAB_ITEMS.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          className={({ isActive }) =>
            `flex flex-1 flex-col items-center justify-center gap-0.5 text-[length:var(--fs-xs)] ${
              isActive ? 'text-signal' : 'text-ink-2'
            }`
          }
        >
          <Icon name={item.icon} size={20} />
          {item.label}
        </NavLink>
      ))}
    </nav>
  );
}
