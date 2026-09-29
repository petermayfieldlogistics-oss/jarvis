export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
  ) {
    super(`Request failed (${status}) for ${url}`);
  }
}

const cache = new Map<string, Promise<unknown>>();

interface FetchJsonOptions {
  /** Abort after this many milliseconds. */
  timeoutMs?: number;
  /** Reuse an earlier response for the same URL during this session. */
  cache?: boolean;
  init?: RequestInit;
}

/** Minimum gap between requests to the same host (Scryfall asks for 50–100 ms). */
const hostSpacingMs: Record<string, number> = { 'api.scryfall.com': 100 };
const hostQueue = new Map<string, Promise<void>>();

function waitForHostSlot(url: string): Promise<void> {
  const host = new URL(url).host;
  const gap = hostSpacingMs[host];
  if (!gap) return Promise.resolve();
  const prev = hostQueue.get(host) ?? Promise.resolve();
  const next = prev.then(() => new Promise<void>((r) => setTimeout(r, gap)));
  hostQueue.set(host, next);
  return prev;
}

export async function fetchJson<T>(url: string, opts: FetchJsonOptions = {}): Promise<T> {
  const useCache = opts.cache ?? true;
  if (useCache && cache.has(url)) return cache.get(url) as Promise<T>;

  const run = (async () => {
    await waitForHostSlot(url);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 15000);
    try {
      const res = await fetch(url, {
        ...opts.init,
        headers: { Accept: 'application/json', ...opts.init?.headers },
        signal: ctrl.signal,
      });
      if (!res.ok) throw new HttpError(res.status, url);
      return (await res.json()) as T;
    } finally {
      clearTimeout(timer);
    }
  })();

  if (useCache) {
    cache.set(url, run);
    // Don't keep failures around; a retry should hit the network again.
    run.catch(() => cache.delete(url));
  }
  return run;
}

/** Like fetchJson, but a 404 resolves to null instead of throwing. */
export async function fetchJsonOrNull<T>(url: string, opts?: FetchJsonOptions): Promise<T | null> {
  try {
    return await fetchJson<T>(url, opts);
  } catch (err) {
    if (err instanceof HttpError && err.status === 404) return null;
    throw err;
  }
}

/** Run `fn` over `items` with at most `limit` in flight at once. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}
