// The page's reads of its own API, in one place. Every component used to repeat
// `fetch(url).then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))`.

/** A response that wasn't 2xx; `status` is the HTTP status (429 when rate limited). */
export class HttpError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`);
    this.name = "HttpError";
  }
}

/** GET `url` and parse its JSON. Rejects with HttpError on a non-2xx answer, and with the network error when there is no answer. */
export async function fetchJson<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new HttpError(r.status);
  return (await r.json()) as T;
}

/** The same, but null instead of rejecting, for optional reads the page works without. */
export const fetchJsonOrNull = <T>(url: string): Promise<T | null> => fetchJson<T>(url).catch(() => null);
