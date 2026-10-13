/**
 * `<Routes>`, shell layout (header/nav/footer/offline banner/toasts), route
 * announcer. ui-spec.md §4.0, §10.
 */
import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router';
import { Header } from './components/shell/Header.js';
import { Nav } from './components/shell/Nav.js';
import { Footer } from './components/shell/Footer.js';
import { OfflineBanner } from './components/shell/OfflineBanner.js';
import { ToastProvider } from './components/shell/Toasts.js';
import { NotFound } from './components/shell/NotFound.js';
import { Skeleton } from './components/ui/Skeleton.js';
import { useMe } from './api/queries.js';
import { COPY } from './lib/constants.js';
import TripPage from './routes/TripPage.js';
import CommutesPage from './routes/CommutesPage.js';
import LoginPage from './routes/LoginPage.js';
import RegisterPage from './routes/RegisterPage.js';
import AboutPage from './routes/AboutPage.js';

// Code-split by route (ui-spec.md §12 DoD): MapPage pulls in maplibre-gl,
// StationPage and ModelPage pull in recharts — keep both out of the main chunk.
const MapPage = lazy(() => import('./routes/MapPage.js'));
const StationPage = lazy(() => import('./routes/StationPage.js'));
const ModelPage = lazy(() => import('./routes/ModelPage.js'));
const AccountPage = lazy(() => import('./routes/AccountPage.js'));

/** Auth guard for `/commutes`. ui-spec.md §4. */
function RequireAuth({ children }: { children: ReactNode }) {
  const location = useLocation();
  const { data: me, isLoading } = useMe();

  if (isLoading) {
    return (
      <div className="mx-auto flex max-w-[880px] flex-col gap-4 px-[var(--gutter)] py-[var(--sp-8)]">
        <Skeleton height={40} />
        <Skeleton height={200} />
      </div>
    );
  }

  if (!me) {
    const next = encodeURIComponent(`${location.pathname}${location.search}`);
    return <Navigate to={`/login?next=${next}`} replace />;
  }

  return <>{children}</>;
}

/** Announces route changes and moves focus to the new page's `h1`. ui-spec.md §10. */
function RouteAnnouncer() {
  const location = useLocation();
  const [announcement, setAnnouncement] = useState('');
  const isFirstRender = useRef(true);

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    const id = window.setTimeout(() => {
      const heading = document.querySelector<HTMLElement>('#content h1');
      if (heading) {
        heading.setAttribute('tabindex', '-1');
        heading.focus();
      }
      setAnnouncement(COPY.a11y.navigatedTo(document.title));
    }, 0);
    return () => window.clearTimeout(id);
  }, [location.pathname]);

  return (
    <div role="status" aria-live="polite" className="visually-hidden">
      {announcement}
    </div>
  );
}

export function App() {
  const location = useLocation();
  const isMapPage = location.pathname === '/';

  return (
    <ToastProvider>
      <a href="#content" className="skip-link">
        {COPY.a11y.skipLink}
      </a>
      <div className="flex min-h-dvh flex-col">
        <Header />
        <OfflineBanner />
        <RouteAnnouncer />
        <main id="content" className="flex-1 pb-[var(--tabbar-h)]">
          <Suspense
            fallback={
              <div className="flex flex-col gap-4 px-[var(--gutter)] py-[var(--sp-8)]">
                <Skeleton height={40} />
                <Skeleton height={200} />
              </div>
            }
          >
            <Routes>
              <Route path="/" element={<MapPage />} />
              <Route path="/station/:id" element={<StationPage />} />
              <Route path="/trip" element={<TripPage />} />
              <Route
                path="/commutes"
                element={
                  <RequireAuth>
                    <CommutesPage />
                  </RequireAuth>
                }
              />
              <Route path="/model" element={<ModelPage />} />
              <Route
                path="/account"
                element={
                  <RequireAuth>
                    <AccountPage />
                  </RequireAuth>
                }
              />
              <Route path="/login" element={<LoginPage />} />
              <Route path="/register" element={<RegisterPage />} />
              <Route path="/about" element={<AboutPage />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </main>
        {!isMapPage && <Footer />}
        <Nav />
      </div>
    </ToastProvider>
  );
}
