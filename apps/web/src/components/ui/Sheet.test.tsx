import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { asPhone } from '../../test/phone.js';
import { Sheet, type SheetSnap } from './Sheet.js';

function renderSheet(snap: SheetSnap, onSnapChange = vi.fn()) {
  render(
    <Sheet open snap={snap} onSnapChange={onSnapChange} onClose={() => undefined} title="Control panel">
      <p>content</p>
    </Sheet>,
  );
  return { handle: screen.getByRole('button', { name: 'Resize panel' }), onSnapChange };
}

function swipe(handle: HTMLElement, fromY: number, toY: number) {
  fireEvent.pointerDown(handle, { clientY: fromY, pointerId: 1 });
  fireEvent.pointerUp(handle, { clientY: toY, pointerId: 1 });
}

describe('Sheet (phone)', () => {
  let restore: () => void;
  afterEach(() => restore());

  it('swipe up from peek moves one snap taller', () => {
    restore = asPhone();
    const up = renderSheet('peek');
    swipe(up.handle, 400, 300);
    expect(up.onSnapChange).toHaveBeenLastCalledWith('half');
  });

  it('swipe down from half moves one snap shorter', () => {
    restore = asPhone();
    const half = renderSheet('half');
    swipe(half.handle, 300, 400);
    expect(half.onSnapChange).toHaveBeenLastCalledWith('peek');
  });

  it('does nothing when swiping down at peek', () => {
    restore = asPhone();
    const peek = renderSheet('peek');
    swipe(peek.handle, 300, 400);
    expect(peek.onSnapChange).not.toHaveBeenCalled();
  });

  it('a short tap cycles to the next snap', () => {
    restore = asPhone();
    const { handle, onSnapChange } = renderSheet('full');
    swipe(handle, 300, 305);
    expect(onSnapChange).toHaveBeenLastCalledWith('peek');
  });

  it('keyboard activation cycles too', async () => {
    restore = asPhone();
    const user = userEvent.setup();
    const { handle, onSnapChange } = renderSheet('peek');
    handle.focus();
    await user.keyboard('{Enter}');
    expect(onSnapChange).toHaveBeenLastCalledWith('half');
  });
});
