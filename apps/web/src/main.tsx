/**
 * @dockcast/web — React 19 SPA entry point. ui-spec.md §1, §8.
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router';
import { App } from './App.js';
import { getTheme, syncThemeColor } from './lib/theme.js';
import { captureInstallPrompt } from './lib/install.js';
import { registerServiceWorker } from './lib/sw.js';
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
syncThemeColor(bootTheme);

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

// Chromium fires `beforeinstallprompt` early; catch it before React mounts (lib/install.ts).
captureInstallPrompt();

/**
 * Registers the build-generated `/sw.js` after first paint (ui-spec.md §8). Production
 * only: the dev server has no sw.js, and a caching worker would fight Vite's HMR.
 */
function startServiceWorker(): void {
  if (!import.meta.env.PROD) return;
  const register = () => {
    registerServiceWorker().catch(() => undefined);
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

  startServiceWorker();
}

enableMocking().then(mount).catch(mount);
