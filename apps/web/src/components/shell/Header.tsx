/**
 * Top bar: logo, desktop nav, city chip, auth state. ui-spec.md §4.0.
 */
import { Link, NavLink } from 'react-router';
import { useAuth } from '../../hooks/useAuth.js';
import { useCities } from '../../api/queries.js';
import { COPY } from '../../lib/constants.js';

const NAV_ITEMS = [
  { to: '/', label: COPY.shell.nav.map },
  { to: '/commutes', label: COPY.shell.nav.commutes },
  { to: '/model', label: COPY.shell.nav.model },
  { to: '/about', label: COPY.shell.nav.about },
];

function truncateEmail(email: string, max = 24): string {
  return email.length > max ? `${email.slice(0, max - 1)}…` : email;
}

export function Header() {
  const { user, logout } = useAuth();
  const { data: citiesData } = useCities();
  const cities = citiesData?.cities ?? [];

  return (
    <header className="flex h-[var(--header-h)] items-center justify-between border-b border-rule bg-surface px-[var(--gutter)] pt-[env(safe-area-inset-top)]">
      <Link to="/" className="flex min-h-11 items-center gap-2 font-[var(--font-display)] font-semibold">
        <img src="/favicon.svg" alt="" width={24} height={24} />
        <span>{COPY.shell.wordmark}</span>
      </Link>

      <nav aria-label="Primary" className="hidden items-center gap-6 md:flex">
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) =>
              `pb-1 text-[length:var(--fs-sm)] font-medium ${
                isActive
                  ? 'border-b-2 border-signal text-signal'
                  : 'border-b-2 border-transparent text-ink-2 hover:text-ink'
              }`
            }
            style={{ textUnderlineOffset: '6px' }}
          >
            {item.label}
          </NavLink>
        ))}
      </nav>

      <div className="flex items-center gap-4">
        {cities.length > 1 && (
          <details className="relative">
            <summary className="cursor-pointer list-none rounded-[var(--r-1)] px-2 py-1 text-[length:var(--fs-sm)] text-ink-2 hover:bg-surface-2">
              {cities[0]?.name}
            </summary>
            <ul className="absolute right-0 z-10 mt-1 w-48 rounded-[var(--r-2)] border border-rule bg-surface p-1" style={{ boxShadow: 'var(--shadow-panel)' }}>
              {cities.map((city) => (
                <li key={city.slug}>
                  <Link
                    to={`/?city=${city.slug}`}
                    className="block rounded-[var(--r-1)] px-2 py-1.5 text-[length:var(--fs-sm)] hover:bg-surface-2"
                  >
                    {city.name}
                  </Link>
                </li>
              ))}
            </ul>
          </details>
        )}

        {user ? (
          <div className="flex items-center gap-3">
            <Link
              to="/account"
              className="hidden text-[length:var(--fs-sm)] text-ink-2 underline-offset-4 hover:underline sm:inline"
            >
              {truncateEmail(user.email)}
            </Link>
            <button
              type="button"
              onClick={() => logout.mutate()}
              className="inline-flex min-h-11 items-center text-[length:var(--fs-sm)] text-signal underline underline-offset-4"
            >
              {COPY.shell.signOut}
            </button>
          </div>
        ) : (
          <Link to="/login" className="inline-flex min-h-11 items-center px-1 text-[length:var(--fs-sm)] text-signal underline underline-offset-4">
            {COPY.shell.signIn}
          </Link>
        )}
      </div>
    </header>
  );
}
