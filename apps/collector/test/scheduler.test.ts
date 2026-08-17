import pino from 'pino';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startInterval } from '../src/scheduler.js';

const logger = pino({ level: 'silent' });

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('startInterval', () => {
  it('runs fn immediately by default, then again after intervalMs', async () => {
    let calls = 0;
    const handle = startInterval('t', 1000, async () => {
      calls++;
    }, logger);
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toBe(1);

    await vi.advanceTimersByTimeAsync(1000);
    expect(calls).toBe(2);

    await handle.stop();
  });

  it('does not run immediately when immediate: false; first run is after intervalMs', async () => {
    let calls = 0;
    const handle = startInterval(
      't',
      1000,
      async () => {
        calls++;
      },
      logger,
      { immediate: false },
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toBe(0);

    await vi.advanceTimersByTimeAsync(1000);
    expect(calls).toBe(1);

    await handle.stop();
  });

  it('skips an overlapping tick while a run is still in flight', async () => {
    let starts = 0;
    let resolveFirst: (() => void) | undefined;
    const handle = startInterval(
      't',
      1000,
      () =>
        new Promise<void>((resolve) => {
          starts++;
          resolveFirst = resolve;
        }),
      logger,
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(starts).toBe(1);

    // Next tick fires while the first run is still in flight: skipped, not started.
    await vi.advanceTimersByTimeAsync(1000);
    expect(starts).toBe(1);

    resolveFirst?.();
    await handle.stop();
  });

  it('stop() clears the timer and awaits an in-flight run before resolving', async () => {
    let finished = false;
    const handle = startInterval(
      't',
      1000,
      () =>
        new Promise<void>((resolve) => {
          setTimeout(() => {
            finished = true;
            resolve();
          }, 500);
        }),
      logger,
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(finished).toBe(false);

    const stopPromise = handle.stop();
    await vi.advanceTimersByTimeAsync(500);
    await stopPromise;
    expect(finished).toBe(true);
  });
});
