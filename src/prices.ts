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

const cache = new Map<string, { value: TokenPrice | null; at: number }>();
const PRICE_TTL_MS = 5 * 60 * 1000;

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
    const key = chunk.map((a) => `${LLAMA_CHAIN}:${a}`).join(",");
    const res = await fetch(LLAMA_URL + key);
    if (!res.ok) {
      throw new Error(`DefiLlama price request failed: ${res.status} ${res.statusText}`);
    }
    const body = (await res.json()) as {
      coins: Record<string, { price: number; decimals?: number; symbol?: string }>;
    };
    for (const addr of chunk) {
      const coin = body.coins[`${LLAMA_CHAIN}:${addr}`];
      const value: TokenPrice | null = coin
        ? { priceUsd: coin.price, decimals: coin.decimals ?? 18, symbol: coin.symbol ?? "?" }
        : null;
      cache.set(addr, { value, at: now });
      result.set(addr, value);
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
