/**
 * Dead-man ping (`docs/collector-spec.md` §3.6). Called after a tick in which
 * every active city's status cycle succeeded. No-op if the URL is unset;
 * errors are logged at `warn` and never thrown.
 */
import type { Logger } from 'pino';
import { fetchWithTimeout, type FetchImpl } from './http.js';

export interface PingHealthchecksOptions {
  fetchImpl?: FetchImpl;
  timeoutMs?: number;
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function pingHealthchecks(
  url: string | undefined,
  logger: Logger,
  opts: PingHealthchecksOptions = {},
): Promise<void> {
  if (!url) return;
  try {
    const res = await fetchWithTimeout(url, {
      fetchImpl: opts.fetchImpl,
      timeoutMs: opts.timeoutMs ?? 5_000,
    });
    if (!res.ok) {
      logger.warn({ event: 'healthchecks_ping_failed', status: res.status }, 'healthchecks ping returned non-2xx');
    }
  } catch (err) {
    logger.warn({ event: 'healthchecks_ping_failed', error: errMsg(err) }, 'healthchecks ping failed');
  }
}
