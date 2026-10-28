/**
 * Once-a-minute availability sampler behind the public uptime figures.
 *
 * It runs in the API process, not the collector: the API is what "website" means, it already
 * hosts the alert scheduler loop, and it is the one process that can observe the database as its
 * users do. The collector can only vouch for itself. Several API instances may run; each samples,
 * but `status_samples` has primary key (component, ts) with ts truncated to the minute, so the
 * extra inserts are dropped (`ON CONFLICT DO NOTHING`) and no leader election is needed.
 *
 * If the API or database is down, no sample is written. Uptime counts a missing minute as down.
 */
import type { Pool } from '@dockcast/db';
import type { Logger } from 'pino';
import { getFreshness, insertSamples } from '../services/status.queries.js';
import { componentStates } from './snapshot.js';
import type { LatencyTracker } from './latency.js';

export interface SamplerDeps {
  pool: Pool;
  logger: Logger;
  latency: LatencyTracker;
  now?: () => Date;
}

/** Takes one sample. Returns false (and writes nothing) if the database could not be read. */
export async function sampleOnce(deps: SamplerDeps): Promise<boolean> {
  const now = (deps.now ?? ((): Date => new Date()))();
  try {
    const t0 = process.hrtime.bigint();
    const fresh = await getFreshness(deps.pool);
    deps.latency.record(Number(process.hrtime.bigint() - t0) / 1e6, now.getTime());
    const s = componentStates(fresh, now);
    await insertSamples(deps.pool, now, [
      { component: 'website', ok: true },
      { component: 'database', ok: true },
      { component: 'stations', ok: s.stations !== 'down' },
      { component: 'forecasts', ok: s.forecasts !== 'down' },
    ]);
    return true;
  } catch (err) {
    deps.logger.warn({ err }, 'status sampler: could not record a sample');
    return false;
  }
}

/** Samples immediately, then on every minute boundary; skips a tick if the previous is still running. */
export function startSampler(deps: SamplerDeps): { stop: () => void } {
  let running = false;
  const tick = (): void => {
    if (running) return;
    running = true;
    void sampleOnce(deps).finally(() => {
      running = false;
    });
  };
  tick();
  let interval: NodeJS.Timeout | undefined;
  const first = setTimeout(() => {
    tick();
    interval = setInterval(tick, 60_000);
    interval.unref();
  }, 60_000 - (Date.now() % 60_000));
  first.unref();
  return {
    stop: () => {
      clearTimeout(first);
      if (interval) clearInterval(interval);
    },
  };
}
