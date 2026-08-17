/**
 * Route smoke tests. ui-spec.md §11 `routes/*.test.tsx`.
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router';
import { App } from './App.js';

function LocationSpy() {
  const location = useLocation();
  return <div data-testid="location-spy">{`${location.pathname}${location.search}`}</div>;
}

function renderApp(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <App />
        <LocationSpy />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('routes', () => {
  it.each([
    ['/login', 'Sign in'],
    ['/register', 'Create account'],
    ['/about', 'About DockCast'],
    ['/trip', 'Trip check'],
    ['/model', 'How good are the forecasts?'],
  ])('%s renders its h1 "%s"', async (path, heading) => {
    renderApp(path);
    expect(await screen.findByRole('heading', { level: 1, name: heading })).toBeInTheDocument();
  });

  it('/commutes redirects unauthenticated visitors to /login?next=/commutes', async () => {
    renderApp('/commutes');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Sign in' }),
    ).toBeInTheDocument();
    expect(screen.getByTestId('location-spy')).toHaveTextContent('/login?next=%2Fcommutes');
  });

  it('unknown routes render the 404 heading', async () => {
    renderApp('/nowhere');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Nothing docked here.' }),
    ).toBeInTheDocument();
  });
});
