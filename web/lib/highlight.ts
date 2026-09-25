import { PROTOCOL } from "./protocol";

/**
 * Tokens whose pools get a small badge in the hot-pools table and the vote
 * swings. Matched by contract ADDRESS, never by symbol: any token can call
 * itself "BNKR", and a badge reads as "this is the real one".
 *
 * Aerodrome/Base only — an address means nothing on another chain. BNKR
 * (BankrCoin, 18 decimals) was checked on Base by reading name()/symbol()
 * from the contract before this was added.
 */
export const HIGHLIGHTED_TOKENS: Record<string, { label: string; name: string }> =
  PROTOCOL === "aerodrome"
    ? { "0x22af33fe49fd1fa80c7149773dde5890d3c76f3b": { label: "BNKR", name: "BankrCoin" } }
    : {};

export function highlightForPool(pool: { token0?: string; token1?: string }): { label: string; name: string } | null {
  for (const token of [pool.token0, pool.token1]) {
    const hit = token ? HIGHLIGHTED_TOKENS[token.toLowerCase()] : undefined;
    if (hit) return hit;
  }
  return null;
}
