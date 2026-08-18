/**
 * @dockcast/web — React 19 SPA entry point. ui-spec.md §1, §8.
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router';
import { App } from './App.js';
import { getTheme } from './lib/theme.js';
import './styles/base.css';
import './styles/charts.css';

// index.html's pre-paint inline <script> bootstrap (ui-spec.md §2.1) is blocked by the
// api's CSP (`script-src 'self'`, no 'unsafe-inline'/nonce — see WP-12 final report), so
// it never runs and a saved theme preference was silently ignored on every fresh page
// load. Applying it here, synchronously before mount(), is the CSP-safe equivalent; it
// no longer prevents the first-paint flash the inline script guaranteed, but restores a
// stored preference correctly, which is the substantive behaviour.
const bootTheme = getTheme();
if (bootTheme !== 'system') document.documentElement.dataset.theme = bootTheme;

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      retry: 1,
      refetchOnWindowFocus: true,
    },
  },
});

/** MSW browser worker, dev-only, gated on `VITE_USE_MOCKS=1`. ui-spec.md §1. */
async function enableMocking(): Promise<void> {
  if (!import.meta.env.DEV || import.meta.env.VITE_USE_MOCKS !== '1') return;
  const { worker } = await import('./mocks/browser.js');
  await worker.start({ onUnhandledRequest: 'bypass' });
}

/**
 * Registers `public/sw.js` after first paint. ui-spec.md §8: the file itself
 * ships in WP-10; registering unconditionally and swallowing the resulting
 * 404 is the "guard fetch failure gracefully" the spec asks for pre-WP-10.
 */
function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator)) return;
  const register = () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* apps/web/public/sw.js doesn't exist until WP-10 */
    });
  };
  if (typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(register);
  } else {
    window.setTimeout(register, 0);
  }
}

function mount(): void {
  const rootElement = document.getElementById('root');
  if (!rootElement) {
    throw new Error('Root element #root not found');
  }

  createRoot(rootElement).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </QueryClientProvider>
    </StrictMode>,
  );

  registerServiceWorker();
}

enableMocking().then(mount).catch(mount);
