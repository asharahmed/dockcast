/** Account page: sign-in methods list (ui-spec.md §4.8). */
import { describe, expect, it, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { userEvent } from '@testing-library/user-event';
import { ToastProvider } from '../components/shell/Toasts.js';
import { http, HttpResponse } from 'msw';
import { server } from '../mocks/server.js';
import { COPY } from '../lib/constants.js';
import AccountPage from './AccountPage.js';

function renderPage(route = '/account') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <MemoryRouter initialEntries={[route]}>
          <Routes>
            <Route path="/account" element={<AccountPage />} />
            <Route path="/" element={<p>map home</p>} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  // The page itself is auth-guarded by the router; for the component test the
  // /auth/me handler must report signed-in.
  server.use(
    http.get('/api/v1/auth/me', () =>
      HttpResponse.json({
        user: { id: '11111111-1111-1111-1111-111111111111', email: 'rider@example.com', created_at: '2026-08-17T12:00:00Z', is_admin: false },
      }),
    ),
  );
});

describe('AccountPage', () => {
  it('deletes the account only after confirming, then returns to the map', async () => {
    const user = userEvent.setup();
    let deleted = 0;
    server.use(
      http.delete('/api/v1/auth/account', () => {
        deleted += 1;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    renderPage();
    await user.click(await screen.findByRole('button', { name: COPY.account.deleteButton }));
    expect(deleted).toBe(0);
    // Cancel backs out without calling the api.
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(deleted).toBe(0);

    await user.click(screen.getByRole('button', { name: COPY.account.deleteButton }));
    await user.click(screen.getByRole('button', { name: COPY.account.deleteConfirmLabel }));
    expect(await screen.findByText('map home')).toBeInTheDocument();
    expect(deleted).toBe(1);
    expect(screen.getByText(COPY.account.deletedToast)).toBeInTheDocument();
  });

  it('lists password state and the connected Google identity with a disconnect control', async () => {
    renderPage();
    expect(await screen.findByText(COPY.account.password)).toBeInTheDocument();
    expect(await screen.findByText('rider@example.com', { selector: 'span' })).toBeInTheDocument();
    expect(
      await screen.findByRole('button', { name: COPY.account.disconnect }),
    ).toBeInTheDocument();
  });

  it('offers Connect for an enabled but unconnected provider', async () => {
    server.use(
      http.get('/api/v1/auth/providers', () => HttpResponse.json({ google: true, apple: true })),
      http.get('/api/v1/auth/identities', () =>
        HttpResponse.json({ has_password: true, identities: [] }),
      ),
    );
    renderPage();
    const links = await screen.findAllByRole('link', { name: COPY.account.connect });
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      '/api/v1/auth/google?link=1&next=%2Faccount',
      '/api/v1/auth/apple?link=1&next=%2Faccount',
    ]);
  });

  it('guards the only sign-in method instead of offering disconnect', async () => {
    server.use(
      http.get('/api/v1/auth/identities', () =>
        HttpResponse.json({
          has_password: false,
          identities: [{ provider: 'google', email: 'rider@example.com', created_at: '2026-08-20T00:00:00Z', is_admin: false }],
        }),
      ),
    );
    renderPage();
    expect(await screen.findByText(COPY.account.onlyMethodNote)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: COPY.account.disconnect })).toBeNull();
  });

  it('shows the conflict banner from ?link=conflict', async () => {
    renderPage('/account?link=conflict');
    expect(await screen.findByText(COPY.account.linkConflict)).toBeInTheDocument();
  });
});
