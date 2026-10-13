import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { captureInstallPrompt } from '../../lib/install.js';
import { InstallCard } from './InstallCard.js';

function fakePromptEvent(outcome: 'accepted' | 'dismissed') {
  const event = new Event('beforeinstallprompt', { cancelable: true }) as Event & {
    prompt: () => Promise<void>;
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
  };
  event.prompt = vi.fn(() => Promise.resolve());
  event.userChoice = Promise.resolve({ outcome });
  return event;
}

function setUserAgent(ua: string) {
  Object.defineProperty(window.navigator, 'userAgent', { value: ua, configurable: true });
}

describe('InstallCard', () => {
  const originalUa = navigator.userAgent;
  beforeAll(() => captureInstallPrompt());
  afterEach(() => setUserAgent(originalUa));

  it('renders nothing where the browser cannot install', () => {
    const { container } = render(<InstallCard />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the Share → Add to Home Screen steps on iOS', () => {
    setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1');
    render(<InstallCard />);
    expect(screen.getByRole('heading', { name: 'Get the app' })).toBeInTheDocument();
    expect(screen.getByText('Choose “Add to Home Screen”')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Install DockCast' })).not.toBeInTheDocument();
  });

  it('replays the captured browser prompt, and confirms once accepted', async () => {
    const user = userEvent.setup();
    render(<InstallCard />);
    const event = fakePromptEvent('accepted');
    act(() => {
      window.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(true);

    await user.click(screen.getByRole('button', { name: 'Install DockCast' }));
    expect(event.prompt).toHaveBeenCalledOnce();
    expect(await screen.findByText('DockCast is installed on this device.')).toBeInTheDocument();
  });
});
