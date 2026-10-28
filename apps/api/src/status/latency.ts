/**
 * Coarse server-side latency for the public page: the 75th percentile of recent API request
 * durations (and of the sampler's own database probe), reduced to `fast` or `slow`. Only the
 * bucket ever leaves the process.
 */
import type { RequestHandler } from 'express';

export const LATENCY_WINDOW_MS = 5 * 60_000;
export const LATENCY_SLOW_MS = 1000;
const MAX_ENTRIES = 256;

export class LatencyTracker {
  private entries: { at: number; ms: number }[] = [];

  record(ms: number, at: number = Date.now()): void {
    this.entries.push({ at, ms });
    if (this.entries.length > MAX_ENTRIES) this.entries.shift();
  }

  bucket(now: number = Date.now()): 'fast' | 'slow' | null {
    const recent = this.entries.filter((e) => now - e.at <= LATENCY_WINDOW_MS).map((e) => e.ms);
    if (recent.length === 0) return null;
    recent.sort((a, b) => a - b);
    const p75 = recent[Math.min(recent.length - 1, Math.floor(recent.length * 0.75))]!;
    return p75 >= LATENCY_SLOW_MS ? 'slow' : 'fast';
  }
}

/** Records the duration of every `/api/v1` request except the status endpoint itself. */
export function latencyMiddleware(tracker: LatencyTracker): RequestHandler {
  return (req, res, next) => {
    if (!req.path.startsWith('/api/v1') || req.path === '/api/v1/status') {
      next();
      return;
    }
    const t0 = process.hrtime.bigint();
    res.on('finish', () => {
      tracker.record(Number(process.hrtime.bigint() - t0) / 1e6);
    });
    next();
  };
}
