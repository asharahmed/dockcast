import { describe, expect, it } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { SW_UPDATE_EVENT } from '../../lib/sw.js';
import { UpdateBanner } from './UpdateBanner.js';

describe('UpdateBanner', () => {
  it('stays hidden until a new worker is announced, then offers Reload and Later', async () => {
    const user = userEvent.setup();
    render(<UpdateBanner />);
    expect(screen.queryByText('A new version of DockCast is ready.')).not.toBeInTheDocument();

    act(() => {
      window.dispatchEvent(new CustomEvent(SW_UPDATE_EVENT));
    });
    expect(screen.getByText('A new version of DockCast is ready.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Later' }));
    expect(screen.queryByText('A new version of DockCast is ready.')).not.toBeInTheDocument();
  });
});
