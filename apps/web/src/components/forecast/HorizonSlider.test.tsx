import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { HorizonSlider } from './HorizonSlider.js';

describe('HorizonSlider', () => {
  const now = new Date('2026-08-17T12:00:00Z');

  it('renders all 7 stops as tick labels', () => {
    // At index 0 "Now" appears twice on screen (the large readout + the
    // tick row) — scope the query to the tick row (the aria-hidden strip).
    const { container } = render(
      <HorizonSlider value={0} onChange={() => {}} cityTz="America/Toronto" now={now} />,
    );
    const tickRow = container.querySelector('[aria-hidden="true"]');
    expect(tickRow).not.toBeNull();
    for (const label of ['Now', '15m', '30m', '45m', '1h', '1h30', '2h']) {
      expect(within(tickRow as HTMLElement).getByText(label)).toBeInTheDocument();
    }
  });

  it('ArrowRight increments the value', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<HorizonSlider value={2} onChange={onChange} cityTz="America/Toronto" now={now} />);
    const slider = screen.getByRole('slider');
    slider.focus();
    await user.keyboard('{ArrowRight}');
    expect(onChange).toHaveBeenCalledWith(3);
  });

  it('caps at the last stop and does not overshoot', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<HorizonSlider value={6} onChange={onChange} cityTz="America/Toronto" now={now} />);
    screen.getByRole('slider').focus();
    await user.keyboard('{ArrowRight}');
    expect(onChange).toHaveBeenCalledWith(6);
  });

  it('sets aria-valuetext to the readout', () => {
    render(<HorizonSlider value={3} onChange={() => {}} cityTz="America/Toronto" now={now} />);
    expect(screen.getByRole('slider')).toHaveAttribute('aria-valuetext', 'In 45 min');
  });

  it('is disabled when disabled=true', () => {
    render(
      <HorizonSlider value={0} onChange={() => {}} disabled cityTz="America/Toronto" now={now} />,
    );
    expect(screen.getByRole('slider')).toBeDisabled();
  });
});
