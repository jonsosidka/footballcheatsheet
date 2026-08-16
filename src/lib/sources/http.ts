/**
 * Shared fetch helper for the upstream data sources.
 *
 * All four sources are free and unauthenticated, which means we're guests:
 * retry politely, back off on 429/5xx, and never hammer. Sleeper's documented
 * ceiling is ~1000 req/min; we stay far under it by batching by position and
 * caching aggressively rather than by fetching per-player.
 */

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
          'user-agent': 'footballcheatsheet/1.0',
          ...headers,
        },
      });

      if (response.status === 404 && nullOn404) return null;

      if (response.status === 429 || response.status >= 500) {
        lastError = new HttpError(`Upstream ${response.status}`, response.status, url);
        continue;
      }

      if (!response.ok) {
        throw new HttpError(`Request failed: ${response.status}`, response.status, url);
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
