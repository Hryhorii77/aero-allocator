// USD token prices via DefiLlama's free coins API. No key required.
import { PROTOCOL } from "./config.js";

const LLAMA_URL = "https://coins.llama.fi/prices/current/";
const BATCH = 80;

// DefiLlama's coins API chain slug — "base" and "optimism" both happen to match viem's chain names here.
const LLAMA_CHAIN = PROTOCOL === "velodrome" ? "optimism" : "base";

export interface TokenPrice {
  priceUsd: number;
  decimals: number;
  symbol: string;
}

interface CacheEntry {
  value: TokenPrice | null;
  at: number;
}

const cache = new Map<string, CacheEntry>();
const PRICE_TTL_MS = 5 * 60 * 1000;
// If DefiLlama is down, a still-recent stale price beats treating the
// token as worthless (every caller here treats a missing price as $0 —
// see sumRewardsUsd and data.ts's scanPools — which would silently zero
// out TVL/reward figures for every affected pool on a bad request).
// Staleness has a ceiling, though: past this, a wrong-but-confident number
// is worse than an honestly-missing one.
const STALE_FALLBACK_MAX_AGE_MS = 60 * 60 * 1000;

type LlamaCoins = Record<string, { price: number; decimals?: number; symbol?: string }>;

/** Public API, occasionally rate-limits/blips — a couple of retries clears most transient failures before falling back to cache. */
async function fetchChunk(chunk: string[]): Promise<LlamaCoins> {
  const key = chunk.map((a) => `${LLAMA_CHAIN}:${a}`).join(",");
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(LLAMA_URL + key);
      if (!res.ok) throw new Error(`DefiLlama price request failed: ${res.status} ${res.statusText}`);
      const body = (await res.json()) as { coins: LlamaCoins };
      return body.coins;
    } catch (e) {
      lastErr = e;
      if (attempt < 2) await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
    }
  }
  throw lastErr;
}

export async function getPrices(addresses: string[]): Promise<Map<string, TokenPrice | null>> {
  const result = new Map<string, TokenPrice | null>();
  const now = Date.now();
  const missing: string[] = [];

  for (const raw of addresses) {
    const addr = raw.toLowerCase();
    const hit = cache.get(addr);
    if (hit && now - hit.at < PRICE_TTL_MS) {
      result.set(addr, hit.value);
    } else {
      missing.push(addr);
    }
  }

  for (let i = 0; i < missing.length; i += BATCH) {
    const chunk = missing.slice(i, i + BATCH);
    try {
      const coins = await fetchChunk(chunk);
      for (const addr of chunk) {
        const coin = coins[`${LLAMA_CHAIN}:${addr}`];
        const value: TokenPrice | null = coin
          ? { priceUsd: coin.price, decimals: coin.decimals ?? 18, symbol: coin.symbol ?? "?" }
          : null;
        cache.set(addr, { value, at: now });
        result.set(addr, value);
      }
    } catch (e) {
      // DefiLlama unreachable/erroring after retries — degrade instead of
      // failing the entire snapshot build (every tool/route needs this).
      // Serve a still-recent stale price where one exists; fall back to
      // "unknown" (-> $0 to callers) for tokens never priced or too stale
      // to trust. Cache entries are left untouched (not re-stamped as
      // fresh), so they keep aging toward STALE_FALLBACK_MAX_AGE_MS if the
      // outage continues.
      console.error(
        JSON.stringify({
          level: "error",
          source: "prices",
          message: `DefiLlama fetch failed for ${chunk.length} token(s), falling back to cache: ${e instanceof Error ? e.message : String(e)}`,
        }),
      );
      for (const addr of chunk) {
        const stale = cache.get(addr);
        result.set(addr, stale && now - stale.at < STALE_FALLBACK_MAX_AGE_MS ? stale.value : null);
      }
    }
  }

  return result;
}

/** Sum a list of (token, rawAmount) rewards into USD. Unknown tokens count as 0. */
export function sumRewardsUsd(
  rewards: ReadonlyArray<{ token: string; amount: bigint }>,
  prices: Map<string, TokenPrice | null>,
): number {
  let total = 0;
  for (const r of rewards) {
    const p = prices.get(r.token.toLowerCase());
    if (!p) continue;
    total += (Number(r.amount) / 10 ** p.decimals) * p.priceUsd;
  }
  return total;
}
