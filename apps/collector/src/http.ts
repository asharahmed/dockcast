/**
 * Timed, injectable `fetch` wrapper (`docs/collector-spec.md` §2.4). Network
 * I/O for GBFS/Open-Meteo/healthchecks all goes through here so every caller
 * gets the same timeout, `User-Agent`, and error shape, and every caller can
 * substitute `fetchImpl` in tests.
 */

/** The subset of the global `fetch` signature every caller depends on. */
export type FetchImpl = typeof fetch;

/** Non-2xx response or a non-JSON body (`fetchJson` only). */
export class HttpError extends Error {
  readonly status: number | 'invalid_json';

  constructor(status: number | 'invalid_json', message?: string) {
    super(message ?? `HTTP error: ${String(status)}`);
    this.name = 'HttpError';
    this.status = status;
  }
}

const USER_AGENT = 'DockCast/1.0 (+https://dockcast.aahmed.ca)';

export interface FetchWithTimeoutOptions {
  /** Abort after this many ms. Default 8000 (collector-spec.md §2.4). */
  timeoutMs?: number;
  /** Defaults to the global `fetch`; tests inject a fixture-serving stub. */
  fetchImpl?: FetchImpl;
  headers?: Record<string, string>;
}

/** `fetch` with an `AbortController` timeout and the DockCast `User-Agent`. No retries. */
export async function fetchWithTimeout(
  url: string,
  opts: FetchWithTimeoutOptions = {},
): Promise<Response> {
  const timeoutMs = opts.timeoutMs ?? 8000;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, {
      signal: controller.signal,
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json', ...opts.headers },
    });
  } finally {
    clearTimeout(timer);
  }
}

/** `fetchWithTimeout` + JSON parse. Non-2xx / non-JSON body → `HttpError`. */
export async function fetchJson<T = unknown>(
  url: string,
  opts: FetchWithTimeoutOptions = {},
): Promise<T> {
  const res = await fetchWithTimeout(url, opts);
  if (!res.ok) {
    throw new HttpError(res.status, `HTTP ${String(res.status)} for ${url}`);
  }
  try {
    return (await res.json()) as T;
  } catch {
    throw new HttpError('invalid_json', `Invalid JSON body from ${url}`);
  }
}
