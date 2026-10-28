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
  models: { ...statusResponseFixture.models, running: null },
};

/** Words that must never reach the screen (mirrors the API-side banned-content list). */
const BANNED = /\b(rss|peak|mib|gib|memory|attempts?|retry|sha|versions?|host|container|docker|postgres|timescale|cloudflare|tunnel|oom|error)\b|bd_|\d{1,2}:\d{2}|\bUTC\b.*\d|03:30/i;

afterEach(() => vi.restoreAllMocks());

describe('StatusPage', () => {
  it('shows the overall state, components, production release and uptime', async () => {
    renderPage();
    expect(screen.getByRole('heading', { level: 1, name: '$ dockcast status' })).toBeInTheDocument();
    expect(await screen.findByText(/all systems operational/)).toBeInTheDocument();
    expect(screen.getAllByText(/station data/).length).toBeGreaterThan(0);
    expect(screen.getByText(/updated 1 min ago/)).toBeInTheDocument();
    expect(screen.getByText(/updated 4 min ago/)).toBeInTheDocument();
    expect(screen.getByText(/last Aug 16/)).toBeInTheDocument();
    expect(screen.getByText(/fast responses/)).toBeInTheDocument();
    expect(screen.getByText('release deployed 3 days ago')).toBeInTheDocument();
    expect(screen.getByText(/uptime 7 days 99\.9% · 30 days 99\.7%/)).toBeInTheDocument();
  });

  it('shows the progress bar with percent, a coarse stage and a rounded ETA while updating', async () => {
    renderPage();
    expect(await screen.findByText('42%')).toBeInTheDocument();
    expect(screen.getByText(/^training/)).toBeInTheDocument();
    expect(screen.getByText(/about 16 min left/)).toBeInTheDocument();
  });

  it('hides the update section when no update is running', async () => {
    serve(idle);
    renderPage();
    await screen.findByText(/all systems operational/);
    expect(screen.queryByRole('heading', { name: 'model update' })).not.toBeInTheDocument();
    expect(screen.queryByText('42%')).not.toBeInTheDocument();
  });

  it('prints --% when there is no reference run', async () => {
    serve({
      ...statusResponseFixture,
      models: { ...statusResponseFixture.models, running: { percent: null, stage: 'preparing data', eta_min: null } },
    });
    renderPage();
    expect(await screen.findByText('--%')).toBeInTheDocument();
    expect(screen.getByText(/^preparing data/)).toBeInTheDocument();
  });

  it('draws a 14-day strip per component and the recent updates table', async () => {
    renderPage();
    await screen.findByText(/all systems operational/);
    const strips = screen.getAllByRole('img');
    expect(strips).toHaveLength(4);
    expect(strips[0]).toHaveAccessibleName(/website, last 14 days: 11 days up, 1 days with downtime, 2 days without data/);
    const glyphs = strips[0]!.textContent!;
    expect([...glyphs.replace(/^website\s+/, '')]).toHaveLength(14);
    expect(screen.getByRole('region', { name: 'Recent model updates' })).toHaveTextContent('Aug 15');
  });

  it('shows degraded and down states with matching words', async () => {
    serve({
      ...statusResponseFixture,
      overall: 'degraded',
      stations: { state: 'degraded', updated_min_ago: 9 },
      database: { state: 'down' },
    });
    renderPage();
    expect(await screen.findByText(/degraded performance/)).toBeInTheDocument();
    expect(screen.getByText(/database\s+down/)).toBeInTheDocument();
  });

  it('renders none of the banned words, clock times or internal names', async () => {
    const { container } = renderPage();
    await screen.findByText(/all systems operational/);
    expect(container.textContent).not.toMatch(BANNED);
    // Also with an update running, a failed day and null values.
    serve({
      ...statusResponseFixture,
      release: { ...statusResponseFixture.release, uptime_7d: null, uptime_30d: null },
      stations: { state: 'down', updated_min_ago: null },
    });
  });

  it('announces overall-state and stage changes, not every poll', async () => {
    const { queryClient } = renderPage();
    const region = screen.getByRole('status');
    await waitFor(() => expect(region).toHaveTextContent('All systems operational. Model update: training.'));

    serve({
      ...statusResponseFixture,
      models: { ...statusResponseFixture.models, running: { percent: 50, stage: 'training', eta_min: 12 } },
    });
    await queryClient.invalidateQueries({ queryKey: ['status'] });
    await screen.findByText('50%');
    expect(region).toHaveTextContent('All systems operational. Model update: training.');

    serve({
      ...statusResponseFixture,
      models: { ...statusResponseFixture.models, running: { percent: 80, stage: 'evaluating', eta_min: 4 } },
    });
    await queryClient.invalidateQueries({ queryKey: ['status'] });
    await waitFor(() => expect(region).toHaveTextContent('Model update: evaluating.'));
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
    await screen.findByText('42%');
    expect(screen.getByText('*')).toBeInTheDocument();
    expect(screen.queryByText(/^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]$/)).not.toBeInTheDocument();
  });

  it('says so when the service is unreachable, without detail', async () => {
    server.use(http.get('/api/v1/status', () => HttpResponse.error()));
    const { container } = renderPage();
    expect(await screen.findByText(/cannot reach the service/)).toBeInTheDocument();
    expect(container.textContent).not.toMatch(BANNED);
  });
});
