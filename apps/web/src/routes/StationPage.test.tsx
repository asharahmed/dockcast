import { describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import StationPage from './StationPage.js';

function renderStationPage(path: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/station/:id" element={<StationPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('StationPage', () => {
  it('renders from the fixture StationDetailResponse: chart, 6 forecast cards, unavailable state', async () => {
    renderStationPage('/station/1');

    expect(await screen.findByRole('heading', { name: 'Union Station', level: 1 })).toBeInTheDocument();

    // The chart container renders once history/current load (jsdom can't
    // measure recharts' ResponsiveContainer, so this checks the wrapper we
    // control rather than recharts' internal SVG).
    expect(await screen.findByTestId('station-chart')).toBeInTheDocument();

    // 6 forecast horizons, one row each.
    const rows = await screen.findAllByTestId('forecast-card');
    expect(rows).toHaveLength(6);

    // The fixture's horizon=45 row has p_bike/p_dock null (unavailable) with
    // reason 'not_fresh' -> "station isn't reporting".
    expect(screen.getByText("station isn't reporting")).toBeInTheDocument();
  });

  it('renders the 404 variant for an unknown station', async () => {
    renderStationPage('/station/999');
    await waitFor(() => {
      expect(screen.getByText("We don't know that station.")).toBeInTheDocument();
    });
  });
});
