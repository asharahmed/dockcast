import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { http, HttpResponse } from 'msw';
import { server } from '../mocks/server.js';
import { statusResponseFixture } from '../mocks/fixtures.js';
import type { StatusResponse } from '../api/types.js';
import StatusPage from './StatusPage.js';

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <StatusPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...utils, queryClient };
}

function serve(body: StatusResponse) {
  server.use(http.get('/api/v1/status', () => HttpResponse.json(body)));
}

const idle: StatusResponse = {
  ...statusResponseFixture,
  train: {
    ...statusResponseFixture.train,
    current: null,
    history: statusResponseFixture.train.history.slice(1),
  },
};

afterEach(() => vi.restoreAllMocks());

describe('StatusPage', () => {
  it('shows the prompt, progress, phase, attempt and services for a running train', async () => {
    renderPage();
    expect(screen.getByRole('heading', { level: 1, name: '$ dockcast status' })).toBeInTheDocument();
    expect(await screen.findByText('42.5%')).toBeInTheDocument();
    expect(screen.getByText(/^assembling feature matrices/)).toBeInTheDocument();
    expect(screen.getByText(/attempt 1\/6/)).toBeInTheDocument();
    expect(screen.getByText(/peak 2\.2 GiB/)).toBeInTheDocument();
    expect(screen.getByText(/dockcast-collector/)).toBeInTheDocument();
    expect(screen.getAllByText(/active \(running\)/).length).toBe(3);
    expect(screen.getByRole('region', { name: 'Recent training runs' })).toHaveTextContent('Aug 16 03:30');
  });

  it('shows idle with the next scheduled run when nothing is running', async () => {
    serve(idle);
    renderPage();
    expect(await screen.findByText(/idle · next run 03:30 E[SD]T/)).toBeInTheDocument();
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
  });

  it('flags a stalled run', async () => {
    serve({
      ...statusResponseFixture,
      train: {
        ...statusResponseFixture.train,
        current: { ...statusResponseFixture.train.current!, state: 'stalled' },
      },
    });
    renderPage();
    expect(await screen.findByText(/stalled: no progress update/)).toBeInTheDocument();
    expect(screen.getByText(/OOM-killed or crashed/)).toBeInTheDocument();
  });

  it('prints -- for percent when there is no reference run', async () => {
    serve({
      ...statusResponseFixture,
      train: {
        ...statusResponseFixture.train,
        current: { ...statusResponseFixture.train.current!, percent: null, eta_s: null },
      },
    });
    renderPage();
    expect(await screen.findByText('--%')).toBeInTheDocument();
    expect(screen.getByText(/eta --/)).toBeInTheDocument();
  });

  it('announces phase changes in the live region, not every poll', async () => {
    const { queryClient } = renderPage();
    const region = screen.getByRole('status');
    await waitFor(() => expect(region).toHaveTextContent('Training: assembling feature matrices.'));

    // Same phase, new numbers: the announcement text must not change.
    serve({
      ...statusResponseFixture,
      train: {
        ...statusResponseFixture.train,
        current: { ...statusResponseFixture.train.current!, percent: 50, elapsed_s: 800 },
      },
    });
    await queryClient.invalidateQueries({ queryKey: ['status'] });
    await screen.findByText('50.0%');
    expect(region).toHaveTextContent('Training: assembling feature matrices.');

    serve({
      ...statusResponseFixture,
      train: {
        ...statusResponseFixture.train,
        current: { ...statusResponseFixture.train.current!, phase: 'calibration', percent: 60 },
      },
    });
    await queryClient.invalidateQueries({ queryKey: ['status'] });
    await waitFor(() =>
      expect(region).toHaveTextContent('Training: fitting the boosted model and calibrators.'),
    );
  });

  it('uses a static marker instead of a spinner under prefers-reduced-motion', async () => {
    vi.spyOn(window, 'matchMedia').mockImplementation(
      (query: string) =>
        ({
          matches: query.includes('prefers-reduced-motion'),
          media: query,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        }) as unknown as MediaQueryList,
    );
    renderPage();
    await screen.findByText('42.5%');
    expect(screen.getByText('*')).toBeInTheDocument();
    expect(screen.queryByText(/^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]$/)).not.toBeInTheDocument();
  });

  it('says so when the api is unreachable', async () => {
    server.use(http.get('/api/v1/status', () => HttpResponse.error()));
    renderPage();
    expect(await screen.findByText(/cannot reach the api/)).toBeInTheDocument();
  });
});
