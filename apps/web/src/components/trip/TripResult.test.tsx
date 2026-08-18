import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { TripResult } from './TripResult.js';
import { ToastProvider } from '../shell/Toasts.js';
import {
  tripResponseGoodFixture,
  tripResponseBadFixture,
  tripResponseTypicalFixture,
} from '../../mocks/fixtures.js';

function renderResult(trip: typeof tripResponseGoodFixture, shareUrl = 'https://dockcast.test/trip?from=1&to=2') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ToastProvider>
          <TripResult trip={trip} cityTz="America/Toronto" shareUrl={shareUrl} />
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('TripResult', () => {
  it('renders the good fixture: verdict, both percents, alternatives collapsed', () => {
    renderResult(tripResponseGoodFixture);
    expect(screen.getByText('Looks good')).toBeInTheDocument();
    expect(screen.getByText('90%')).toBeInTheDocument();
    expect(screen.getByText('92%')).toBeInTheDocument();
    // Both legs are forecast with p >= ALT_GOOD_P -> alternatives collapsed
    // behind the reveal button on both legs.
    expect(screen.getAllByText('Other nearby stations').length).toBe(2);
  });

  it('renders the bad fixture: verdict, unavailable reason, alternatives expanded with Safe bet', () => {
    renderResult(tripResponseBadFixture);
    expect(screen.getByText("Don't count on it")).toBeInTheDocument();
    expect(screen.getByText("station isn't reporting")).toBeInTheDocument();
    // dest leg alternatives are force-expanded (kind !== 'forecast')
    expect(screen.getByText('Yonge / Wellesley', { selector: 'a' })).toBeInTheDocument();
    expect(screen.getByText(/Safe bet/)).toBeInTheDocument();
  });

  it('renders the typical fixture: "Can\'t tell yet" + typical label', () => {
    renderResult(tripResponseTypicalFixture);
    expect(screen.getByText("Can't tell yet")).toBeInTheDocument();
    expect(screen.getAllByText(/Typical for this time/).length).toBe(2);
  });

  it('Share click copies the URL and toasts "Link copied"', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

    renderResult(tripResponseGoodFixture, 'https://dockcast.test/trip?from=1&to=2&at=x&ride=15');
    await user.click(screen.getByRole('button', { name: 'Share' }));

    expect(writeText).toHaveBeenCalledWith('https://dockcast.test/trip?from=1&to=2&at=x&ride=15');
    expect(await screen.findByText('Link copied')).toBeInTheDocument();
  });
});
