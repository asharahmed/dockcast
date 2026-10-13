import { afterEach, describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { stationDetailResponseFixture } from '../../mocks/fixtures.js';
import { asPhone } from '../../test/phone.js';
import { ForecastTable } from './ForecastTable.js';

function renderTable() {
  return render(
    <MemoryRouter>
      <ForecastTable forecasts={stationDetailResponseFixture.forecasts} cityTz="America/Toronto" />
    </MemoryRouter>,
  );
}

describe('ForecastTable', () => {
  let restore: (() => void) | null = null;
  afterEach(() => {
    restore?.();
    restore = null;
  });

  it('renders a table on wider screens', () => {
    renderTable();
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Expected bikes' })).toBeInTheDocument();
  });

  it('stacks one block per horizon on phones, with labelled probabilities and the expected count', () => {
    restore = asPhone();
    renderTable();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    const cards = screen.getAllByTestId('forecast-card');
    expect(cards).toHaveLength(stationDetailResponseFixture.forecasts.length);
    const first = within(cards[0]!);
    expect(first.getByText('15 min')).toBeInTheDocument();
    expect(first.getByText('Bike')).toBeInTheDocument();
    expect(first.getByText('Dock')).toBeInTheDocument();
    expect(first.getByText('82%')).toBeInTheDocument();
    expect(first.getByText('About 4 bikes expected (range 2–7)')).toBeInTheDocument();
  });
});
