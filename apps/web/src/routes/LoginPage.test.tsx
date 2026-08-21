/** OAuth button on the sign-in page (ui-spec.md §4.6). */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { http, HttpResponse } from 'msw';
import { server } from '../mocks/server.js';
import { COPY } from '../lib/constants.js';
import LoginPage from './LoginPage.js';

function renderPage(route: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[route]}>
        <LoginPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('LoginPage OAuth', () => {
  it('shows "Continue with Google" linking to the OAuth start URL when configured', async () => {
    renderPage('/login?next=%2Fcommutes');
    const link = await screen.findByRole('link', { name: COPY.auth_pages.continueWithGoogle });
    expect(link).toHaveAttribute('href', '/api/v1/auth/google?next=%2Fcommutes');
  });

  it('shows "Continue with Apple" when that provider is configured', async () => {
    server.use(
      http.get('/api/v1/auth/providers', () => HttpResponse.json({ google: true, apple: true })),
    );
    renderPage('/login');
    const link = await screen.findByRole('link', { name: COPY.auth_pages.continueWithApple });
    expect(link).toHaveAttribute('href', '/api/v1/auth/apple?next=%2Fcommutes');
  });

  it('hides the button when the deployment has no OAuth configured', async () => {
    server.use(
      http.get('/api/v1/auth/providers', () => HttpResponse.json({ google: false, apple: false })),
    );
    renderPage('/login');
    await screen.findByRole('button', { name: COPY.auth_pages.signInButton });
    expect(screen.queryByText(COPY.auth_pages.continueWithGoogle)).toBeNull();
  });

  it('surfaces ?oauth=failed as an inline error', async () => {
    renderPage('/login?oauth=failed');
    expect(await screen.findByText(COPY.auth_pages.errors.oauthFailed)).toBeInTheDocument();
  });
});
