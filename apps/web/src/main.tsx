import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

/**
 * @dockcast/web — React 19 SPA entry point (docs/ui-spec.md, docs/plan.md WP-9/WP-10).
 *
 * This is a WP-0 placeholder render so the package builds and typechecks.
 * The real <App/> (routes, shell, providers) lands in WP-9.
 */
const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element #root not found');
}

createRoot(rootElement).render(
  <StrictMode>
    <div>DockCast</div>
  </StrictMode>,
);
