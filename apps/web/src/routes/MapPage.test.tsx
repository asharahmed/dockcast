/** City picker on the map control panel — shown only with >1 city. */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { http, HttpResponse } from 'msw';
import { server } from '../mocks/server.js';
import { cityListResponseFixture } from '../mocks/fixtures.js';
import { COPY } from '../lib/constants.js';
import MapPage from './MapPage.js';

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <MapPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const secondCity = {
  ...cityListResponseFixture.cities[0]!,
  slug: 'montreal',
  name: 'Bixi Montréal',
};

describe('MapPage city picker', () => {
  it('renders a picker listing every city when more than one exists', async () => {
    server.use(
      http.get('/api/v1/cities', () =>
        HttpResponse.json({ cities: [...cityListResponseFixture.cities, secondCity] }),
      ),
    );
    renderPage();
    const picker = await screen.findByRole('combobox', { name: COPY.map.cityLabel });
    const labels = [...picker.querySelectorAll('option')].map((o) => o.textContent);
    expect(labels).toContain('Bixi Montréal');
    expect(labels).toHaveLength(2);
  });

  it('hides the picker for a single-city deployment', async () => {
    renderPage();
    await screen.findByPlaceholderText(COPY.map.searchPlaceholder);
    expect(screen.queryByRole('combobox', { name: COPY.map.cityLabel })).toBeNull();
  });
});
