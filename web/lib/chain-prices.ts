import type { Address } from "viem";

// USD prices from DefiLlama's coins API for any chain (the engine's getPrices is fixed to the build's own chain).
// Cached five minutes per token; a token it can't price is simply absent, which callers count as $0.
export interface ChainTokenPrice {
  priceUsd: number;
  decimals: number;
}

const TTL_MS = 5 * 60_000;
const BATCH = 80;
const cache = new Map<string, { at: number; value: ChainTokenPrice | null }>();

export async function getChainPrices(slug: string, tokens: Address[]): Promise<Map<string, ChainTokenPrice | null>> {
  const out = new Map<string, ChainTokenPrice | null>();
  const missing: string[] = [];
  for (const t of new Set(tokens.map((x) => x.toLowerCase()))) {
    const hit = cache.get(`${slug}:${t}`);
    if (hit && Date.now() - hit.at < TTL_MS) out.set(t, hit.value);
    else missing.push(t);
  }
  for (let i = 0; i < missing.length; i += BATCH) {
    const chunk = missing.slice(i, i + BATCH);
    try {
      const res = await fetch(`https://coins.llama.fi/prices/current/${chunk.map((t) => `${slug}:${t}`).join(",")}`);
      if (!res.ok) continue;
      const body = (await res.json()) as { coins: Record<string, { price: number; decimals?: number }> };
      for (const t of chunk) {
        const c = body.coins[`${slug}:${t}`];
        const value = c && typeof c.price === "number" && c.decimals !== undefined ? { priceUsd: c.price, decimals: c.decimals } : null;
        cache.set(`${slug}:${t}`, { at: Date.now(), value });
        out.set(t, value);
      }
    } catch {
      // A price outage leaves these tokens unpriced rather than failing the whole read.
    }
  }
  return out;
}
