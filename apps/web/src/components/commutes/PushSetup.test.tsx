/**
 * ui-spec.md §11: "PushSetup state machine with mocked
 * Notification/PushManager." `navigator.serviceWorker`/`Notification`/
 * `PushManager` don't exist in jsdom by default — each scenario stubs
 * exactly what it needs.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PushSetup } from './PushSetup.js';
import { ToastProvider } from '../shell/Toasts.js';

function renderPushSetup() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <PushSetup />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

function stubNotification(permission: string, requestResult: string = permission) {
  vi.stubGlobal('Notification', {
    permission,
    requestPermission: vi.fn().mockResolvedValue(requestResult),
  });
}

function stubServiceWorker(getSubscriptionResult: unknown) {
  const registration = {
    pushManager: {
      getSubscription: vi.fn().mockResolvedValue(getSubscriptionResult),
      subscribe: vi.fn().mockResolvedValue({
        endpoint: 'https://push.example/abc',
        toJSON: () => ({ keys: { p256dh: 'p', auth: 'a' } }),
      }),
    },
  };
  Object.defineProperty(navigator, 'serviceWorker', {
    value: { ready: Promise.resolve(registration) },
    configurable: true,
  });
  vi.stubGlobal('PushManager', class {});
  return registration;
}

afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, 'serviceWorker');
});

describe('PushSetup', () => {
  it('shows the unsupported message with no relevant browser APIs', async () => {
    renderPushSetup();
    expect(
      await screen.findByText(/Alerts need a browser with push notifications/),
    ).toBeInTheDocument();
  });

  it('shows the denied message when Notification.permission is "denied"', async () => {
    stubNotification('denied');
    stubServiceWorker(null);
    renderPushSetup();
    expect(
      await screen.findByText(/Notifications are blocked for this site/),
    ).toBeInTheDocument();
  });

  it('shows the default (enable) message when permission is default and not subscribed', async () => {
    stubNotification('default');
    stubServiceWorker(null);
    renderPushSetup();
    expect(
      await screen.findByText('Get a push before you leave if the odds drop.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Enable alerts' })).toBeInTheDocument();
  });

  it('shows the subscribed message when permission is granted and a subscription exists', async () => {
    stubNotification('granted');
    stubServiceWorker({ endpoint: 'https://push.example/abc' });
    renderPushSetup();
    expect(await screen.findByText('Alerts are on for this device.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send a test' })).toBeInTheDocument();
  });

  it('clicking "Enable alerts" subscribes and moves to the subscribed state', async () => {
    const user = userEvent.setup();
    stubNotification('default', 'granted');
    stubServiceWorker(null);
    renderPushSetup();

    const enableButton = await screen.findByRole('button', { name: 'Enable alerts' });
    await user.click(enableButton);

    expect(await screen.findByText('Alerts are on for this device.')).toBeInTheDocument();
  });
});
