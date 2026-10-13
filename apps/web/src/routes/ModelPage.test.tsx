import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { http, HttpResponse } from 'msw';
import { metricsTierForServing } from '@dockcast/shared';
import { server } from '../mocks/server.js';
import { modelResponseFixture } from '../mocks/fixtures.js';
import type { ModelResponse } from '../api/types.js';
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

/** What the api sends a non-operator (docs/api.md §4), derived from the operator fixture. */
function publicModelResponse(): ModelResponse {
  const serving = metricsTierForServing(modelResponseFixture.predictor.serving_tier);
  return {
    ...modelResponseFixture,
    viewer: { is_admin: false },
    versions: [],
    metrics: modelResponseFixture.metrics.filter(
      (m) => m.tier === 'persistence' || m.tier === serving,
    ),
    active: {
      gbm: modelResponseFixture.active.gbm && { ...modelResponseFixture.active.gbm, metrics_val: null, gate: null },
      bd: modelResponseFixture.active.bd && { ...modelResponseFixture.active.bd, metrics_val: null, gate: null },
    },
  };
}

describe('ModelPage (operator view)', () => {
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

describe('ModelPage (public view)', () => {
  it('explains the serving model and its headline accuracy, without versions or per-tier charts', async () => {
    server.use(http.get('/api/v1/model', () => HttpResponse.json(publicModelResponse())));
    renderPage();
    expect(
      await screen.findByRole('heading', { name: "What's forecasting right now" }),
    ).toBeInTheDocument();
    // Fixture serves gbm: the paragraph for the learned model.
    expect(screen.getByText(/Forecasts come from the learned model/)).toBeInTheDocument();
    // Brier an hour ahead: gbm 0.078 vs persistence 0.118 → 34% less error (both targets share the fixture curve).
    expect(
      screen.getByText(
        'The chance-of-a-bike forecast has 34% less error than assuming nothing changes; the chance-of-a-dock forecast, 34% less error.',
      ),
    ).toBeInTheDocument();
    // ECE 0.018 → 1.8 points; MAE 0.9 bikes.
    expect(screen.getByText(/Calibration gap: 1\.8 points for bikes, 1\.8 for docks\./)).toBeInTheDocument();
    expect(screen.getByText('Expected bike counts are off by 0.9 bikes on average.')).toBeInTheDocument();
    // Calibration chart for the serving tier only; nothing from the operator view.
    expect(screen.getByText('Calibration · last 7 days')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Model versions' })).not.toBeInTheDocument();
    expect(
      screen.queryByText('Brier score by horizon (lower is better) · last 7 days'),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('All stations')).not.toBeInTheDocument();
  });

  it('falls back to an empty accuracy state when nothing is scored yet', async () => {
    server.use(
      http.get('/api/v1/model', () =>
        HttpResponse.json({
          ...publicModelResponse(),
          predictor: { last_run_at: null, serving_tier: 'bd_raw' },
          metrics: [],
        }),
      ),
    );
    renderPage();
    expect(await screen.findByText(/Forecasts come from the flow model:/)).toBeInTheDocument();
    expect(
      screen.getByText(
        'No scored forecasts yet for the model that is serving. Scores appear after the first full day of forecasts.',
      ),
    ).toBeInTheDocument();
  });
});
