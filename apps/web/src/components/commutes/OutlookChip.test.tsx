import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { OutlookChip } from './OutlookChip.js';
import type { CommuteOutlook } from '../../api/types.js';

// 2026-08-17T12:00:00Z is 08:00 EDT (Monday) in America/Toronto.
const now = new Date('2026-08-17T12:00:00Z');

function renderChip(outlook: CommuteOutlook) {
  return render(
    <MemoryRouter>
      <OutlookChip
        outlook={outlook}
        originId={1}
        destId={2}
        rideMinutes={15}
        cityTz="America/Toronto"
        now={now}
      />
    </MemoryRouter>,
  );
}

describe('OutlookChip', () => {
  it('shows "Next: today <time>" for a departure later today', () => {
    renderChip({
      next_depart_at: '2026-08-17T16:15:00Z', // 12:15 PM EDT, same local day
      next_arrive_at: '2026-08-17T16:30:00Z',
      origin: { kind: 'forecast', p: 0.8 },
      dest: { kind: 'forecast', p: 0.7 },
      verdict: 'good',
    });
    expect(screen.getByText(/Next: today/)).toBeInTheDocument();
  });

  it('shows "Next: tomorrow <time>" for a departure tomorrow', () => {
    renderChip({
      next_depart_at: '2026-08-18T12:15:00Z', // 8:15 AM EDT next local day
      next_arrive_at: '2026-08-18T12:30:00Z',
      origin: { kind: 'forecast', p: 0.8 },
      dest: { kind: 'forecast', p: 0.7 },
      verdict: 'good',
    });
    expect(screen.getByText(/Next: tomorrow/)).toBeInTheDocument();
  });

  it('shows "Next: <EEE h:mm a>" for a departure further out', () => {
    renderChip({
      next_depart_at: '2026-08-21T12:15:00Z',
      next_arrive_at: '2026-08-21T12:30:00Z',
      origin: { kind: 'forecast', p: 0.8 },
      dest: { kind: 'forecast', p: 0.7 },
      verdict: 'good',
    });
    expect(screen.getByText(/^Next: [A-Za-z]{3} \d/)).toBeInTheDocument();
  });

  it('shows "No upcoming departure" when next_depart_at is null', () => {
    renderChip({
      next_depart_at: null,
      next_arrive_at: null,
      origin: { kind: 'forecast', p: null },
      dest: { kind: 'forecast', p: null },
      verdict: 'unknown',
    });
    expect(screen.getByText('No upcoming departure')).toBeInTheDocument();
  });

  it('appends "(typical)" when either leg is typical', () => {
    renderChip({
      next_depart_at: '2026-08-17T16:15:00Z',
      next_arrive_at: '2026-08-17T16:30:00Z',
      origin: { kind: 'typical', p: 0.6 },
      dest: { kind: 'forecast', p: 0.7 },
      verdict: 'unknown',
    });
    expect(screen.getByText(/\(typical\)/)).toBeInTheDocument();
  });
});
