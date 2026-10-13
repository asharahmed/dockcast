import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useSearchParams } from 'react-router';
import { TripPlanner } from './TripPlanner.js';
import { ToastProvider } from '../shell/Toasts.js';
import { stationListResponseFixture, mapResponseFixture } from '../../mocks/fixtures.js';

function ParamsSpy() {
  const [params] = useSearchParams();
  return <div data-testid="params">{params.toString()}</div>;
}

function renderPlanner(initialPath = '/trip') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialPath]}>
        <ToastProvider>
          <TripPlanner
            stations={stationListResponseFixture.stations}
            mapStations={mapResponseFixture.stations}
            cityTz="America/Toronto"
            now={new Date('2026-08-17T12:00:00Z')}
          />
        </ToastProvider>
        <ParamsSpy />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function selectStation(
  user: ReturnType<typeof userEvent.setup>,
  labelText: string,
  query: string,
  optionName: string,
) {
  const combobox = screen.getByRole('combobox', { name: labelText });
  await user.type(combobox, query);
  const option = await screen.findByRole('option', { name: new RegExp(optionName) });
  await user.click(option);
}

describe('TripPlanner', () => {
  it('labels the ride-time box itself, shows "auto" until stations are picked, then the estimate', async () => {
    const user = userEvent.setup();
    renderPlanner();
    const ride = screen.getByRole('spinbutton', { name: 'Ride time' });
    expect(ride).toHaveAttribute('placeholder', 'auto');
    expect(ride).toHaveValue(null);
    expect(ride).toHaveAccessibleDescription('Estimated at 12 km/h');

    await selectStation(user, 'From', 'Union', 'Union Station');
    await selectStation(user, 'To', 'Bay', 'Bay / College');
    expect(Number((ride as HTMLInputElement).value)).toBeGreaterThan(0);
  });

  it('shows a validation error on empty submit', async () => {
    const user = userEvent.setup();
    renderPlanner();
    await user.click(screen.getByRole('button', { name: 'Check my trip' }));
    expect(screen.getByText('Choose a station')).toBeInTheDocument();
  });

  it('shows "Pick two different stations" when origin === dest', async () => {
    const user = userEvent.setup();
    renderPlanner();
    await selectStation(user, 'From', 'Union', 'Union Station');
    await selectStation(user, 'To', 'Union', 'Union Station');
    await user.click(screen.getByRole('button', { name: 'Check my trip' }));
    expect(screen.getByText('Pick two different stations')).toBeInTheDocument();
  });

  it('syncs a valid submission to the URL (?from=&to=&at=&ride=)', async () => {
    const user = userEvent.setup();
    renderPlanner();
    await selectStation(user, 'From', 'Union', 'Union Station');
    await selectStation(user, 'To', 'Yonge', 'Yonge / Wellesley');
    await user.click(screen.getByRole('button', { name: 'Check my trip' }));

    const params = screen.getByTestId('params').textContent ?? '';
    expect(params).toContain('from=1');
    expect(params).toContain('to=2');
    expect(params).toContain('at=');
    expect(params).toContain('ride=');
  });

  it('auto-runs (renders the collapsed summary) when ?from&to are already present on load', async () => {
    const initialParams = new URLSearchParams({
      from: '1',
      to: '2',
      at: '2026-08-17T12:15:00.000Z',
      ride: '15',
    });
    renderPlanner(`/trip?${initialParams.toString()}`);

    expect(
      await screen.findByText(/From Union Station to Yonge \/ Wellesley/),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Check my trip' })).not.toBeInTheDocument();
  });
});
