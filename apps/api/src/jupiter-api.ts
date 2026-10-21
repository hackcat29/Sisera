const KEYED_BASE = "https://api.jup.ag";
const KEYLESS_BASE = "https://lite-api.jup.ag";
/** How long to stop sending a rejected key before trying it again. */
const REJECTED_KEY_PAUSE_MS = 10 * 60_000;

type JupiterRequestInit = Omit<RequestInit, "headers"> & { headers?: Record<string, string> };
export type JupiterFetch = (path: string, init?: JupiterRequestInit) => Promise<Response>;

/**
 * Sends requests to Jupiter's keyed API, or to its keyless API when no key is configured or the
 * key is rejected. Both serve the same endpoints; the keyless one has lower rate limits. Without
 * the fallback an expired or revoked key turned every swap, stock trade and price into an error.
 */
export function jupiterFetch(apiKey?: string, fetcher?: typeof fetch): JupiterFetch {
  let keyPausedUntil = 0;
  return async (path, init = {}) => {
    const send = fetcher ?? globalThis.fetch;
    if (apiKey && Date.now() >= keyPausedUntil) {
      const response = await send(`${KEYED_BASE}${path}`, {
        ...init,
        headers: { ...init.headers, "x-api-key": apiKey },
      });
      if (response.status !== 401 && response.status !== 403) return response;
      keyPausedUntil = Date.now() + REJECTED_KEY_PAUSE_MS;
      console.warn(
        `[jupiter] API key rejected with ${response.status}; using the keyless API for 10 minutes. Replace JUPITER_API_KEY.`,
      );
    }
    return send(`${KEYLESS_BASE}${path}`, init);
  };
}
