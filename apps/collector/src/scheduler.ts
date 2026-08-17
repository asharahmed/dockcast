/**
 * Non-overlapping interval runner (`docs/collector-spec.md` §6). Runs `fn()`
 * immediately, then on `setInterval`; a `running` flag makes a slow run skip
 * (and log) the next tick instead of overlapping it. `stop()` clears the
 * timer and awaits any in-flight run.
 */
import type { Logger } from 'pino';

export interface IntervalHandle {
  stop(): Promise<void>;
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export interface StartIntervalOptions {
  /**
   * Run `fn()` immediately on start, in addition to every `intervalMs`.
   * Default `true`. Pass `false` when the caller has already run the
   * equivalent "on boot" cycle itself (collector-spec.md §4: information
   * sync runs once explicitly before intervals start, so its own recurring
   * interval must not also fire immediately).
   */
  immediate?: boolean;
}

export function startInterval(
  name: string,
  intervalMs: number,
  fn: () => Promise<void>,
  logger: Logger,
  opts: StartIntervalOptions = {},
): IntervalHandle {
  let running = false;
  let stopped = false;
  let inFlight: Promise<void> | null = null;

  function tick(): void {
    if (stopped) return;
    if (running) {
      logger.info({ event: 'cycle_skipped', name });
      return;
    }
    running = true;
    inFlight = fn()
      .catch((err: unknown) => {
        logger.error({ event: 'interval_error', name, error: errMsg(err) }, 'uncaught error in interval cycle');
      })
      .finally(() => {
        running = false;
        inFlight = null;
      });
  }

  if (opts.immediate ?? true) tick();
  const timer = setInterval(tick, intervalMs);

  return {
    async stop() {
      stopped = true;
      clearInterval(timer);
      if (inFlight) await inFlight;
    },
  };
}
