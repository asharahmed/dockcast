import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { HORIZONS } from '@dockcast/shared';
import { BrierChart } from './BrierChart.js';
import type { ModelMetricRow } from '../../api/types.js';

function buildRows(): ModelMetricRow[] {
  const rows: ModelMetricRow[] = [];
  for (const tier of ['persistence', 'gbm_active'] as const) {
    for (const horizon of HORIZONS) {
      rows.push({
        day: '2026-08-16',
        window_days: 7,
        tier,
        target: 'bike',
        horizon,
        slice: 'all',
        metric: 'brier',
        value: 0.1,
        n: 100,
      });
    }
  }
  return rows;
}

describe('BrierChart', () => {
  it('renders 2 legend entries in fixed tier order with tokens --s1 (gbm_active) and --s3 (persistence) — never re-coloured', () => {
    const { container } = render(<BrierChart metrics={buildRows()} target="bike" slice="all" />);
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('gbm');
    expect(items[1]).toHaveTextContent('persistence');

    const swatches = container.querySelectorAll('li > span[aria-hidden="true"]');
    expect(swatches[0]?.getAttribute('style')).toContain('var(--s1)');
    expect(swatches[1]?.getAttribute('style')).toContain('var(--s3)');
  });

  it('table twin renders 6 rows (one per horizon)', async () => {
    const user = userEvent.setup();
    render(<BrierChart metrics={buildRows()} target="bike" slice="all" />);
    await user.click(screen.getByRole('button', { name: 'Table' }));
    const rows = screen.getByRole('table').querySelectorAll('tbody tr');
    expect(rows).toHaveLength(6);
  });

  it('renders an empty state when no matching rows exist', () => {
    render(<BrierChart metrics={[]} target="bike" slice="all" />);
    expect(
      screen.getByText('No scored forecasts yet. Scores appear after the first full day of forecasts.'),
    ).toBeInTheDocument();
  });

  it('says which day it covers when the 7-day window is behind the newest metrics day', () => {
    // What a trainer that died between the 1-day and 7-day passes leaves behind: the API
    // serves each window its own latest day, so the chart renders but is a day short.
    const metrics: ModelMetricRow[] = [
      ...buildRows(),
      {
        day: '2026-08-17',
        window_days: 1,
        tier: 'gbm_active',
        target: 'bike',
        horizon: 0,
        slice: 'all',
        metric: 'brier',
        value: 0.1,
        n: 100,
      },
    ];
    render(<BrierChart metrics={metrics} target="bike" slice="all" />);
    expect(screen.getByText('· scored through 16 Aug')).toBeInTheDocument();
  });

  it('says nothing about the day when every window is scored for the same day', () => {
    render(<BrierChart metrics={buildRows()} target="bike" slice="all" />);
    expect(screen.queryByText(/scored through/)).not.toBeInTheDocument();
  });
});
