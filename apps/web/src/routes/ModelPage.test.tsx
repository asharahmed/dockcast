import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { http, HttpResponse } from 'msw';
import { server } from '../mocks/server.js';
import { modelResponseFixture } from '../mocks/fixtures.js';
import ModelPage from './ModelPage.js';

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ModelPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ModelPage', () => {
  it('renders charts and the versions table from the fixture ModelResponse', async () => {
    renderPage();
    expect(
      await screen.findByRole('heading', { level: 1, name: 'How good are the forecasts?' }),
    ).toBeInTheDocument();
    expect(
      await screen.findByText('Brier score by horizon (lower is better) · last 7 days'),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Model versions' })).toBeInTheDocument();
  });

  it('shows an empty state when metrics is empty', async () => {
    server.use(
      http.get('/api/v1/model', () => HttpResponse.json({ ...modelResponseFixture, metrics: [] })),
    );
    renderPage();
    expect(
      await screen.findByText(
        'No scored forecasts yet. Scores appear after the first full day of forecasts.',
      ),
    ).toBeInTheDocument();
  });
});
