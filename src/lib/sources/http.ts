/**
 * Shared fetch helper for the upstream data sources.
 *
 * All four sources are free and unauthenticated, which means we're guests:
 * retry politely, back off on 429/5xx, and never hammer. Sleeper's documented
 * ceiling is ~1000 req/min; we stay far under it by batching by position and
 * caching aggressively rather than by fetching per-player.
 */

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly url: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export interface FetchJsonOptions {
  retries?: number;
  timeoutMs?: number;
  headers?: Record<string, string>;
  /** Treat 404 as "no data yet" rather than an error (common preseason). */
  nullOn404?: boolean;
}

export async function fetchJson<T>(url: string, options: FetchJsonOptions = {}): Promise<T | null> {
  const { retries = 3, timeoutMs = 20_000, headers = {}, nullOn404 = false } = options;

  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) {
      // 500ms, 1s, 2s — enough to clear a transient rate limit.
      await sleep(500 * 2 ** (attempt - 1));
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          accept: 'application/json',
          // ESPN's public endpoints reject unrecognized user-agents with a 403
          // from datacenter IPs — it worked from a laptop and failed from
          // Netlify until this was a real browser string.
          'user-agent': USER_AGENT,
          'accept-language': 'en-US,en;q=0.9',
          ...headers,
        },
      });

      if (response.status === 404 && nullOn404) return null;

      if (response.status === 429 || response.status >= 500) {
        lastError = new HttpError(`Upstream ${response.status}`, response.status, url);
        continue;
      }

      if (!response.ok) {
        // Include the host: a bare status is useless when four upstreams are in
        // play and only one of them is blocking us.
        throw new HttpError(
          `Request failed: ${response.status} from ${new URL(url).host}`,
          response.status,
          url,
        );
      }

      return (await response.json()) as T;
    } catch (error) {
      lastError = error;
      // A non-retryable client error should surface immediately.
      if (error instanceof HttpError && error.status < 500 && error.status !== 429) throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(`Failed to fetch ${url}`);
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Run tasks with bounded concurrency so we never burst a free API. */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;

  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await fn(items[index], index);
    }
  });

  await Promise.all(workers);
  return results;
}
