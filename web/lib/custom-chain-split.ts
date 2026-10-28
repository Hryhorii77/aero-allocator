import { bestSplit } from "./split";
import type { ChainBook, ChainShare } from "./all-chains-split";

export interface CustomShare {
  chainId: number;
  name: string;
  /** Share of the whole position, in hundredths of a percent (3000 = 30%). */
  hundredths: number;
}

export type CustomResult = { chains: ChainShare[]; usdPerDay: number } | { error: string };

/** Parses a typed percentage ("30", "12.5") into hundredths of a percent; null when it isn't a number from 0 to 100 with at most two decimals. */
export function percentToHundredths(text: string): number | null {
  const t = text.trim().replace(",", ".");
  if (t === "") return 0;
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(t)) return null;
  const n = Math.round(Number(t) * 100);
  return n >= 0 && n <= 10_000 ? n : null;
}

/**
 * A split the owner chose chain by chain: each chain gets its share of the position, and on each chain the gauges are the best split
 * for that share (so the mix inside a chain is still the one that earns the most). Shares are whole hundredths of a percent and must
 * add up to exactly 10,000; a chain with a share but no gauge that can be ranked is an error rather than a silent gap.
 */
export function customChainSplit(shares: CustomShare[], power: number, books: ChainBook[]): CustomResult {
  const used = shares.filter((s) => s.hundredths > 0);
  if (used.length === 0) return { error: "Give at least one chain a share." };
  if (used.reduce((s, x) => s + x.hundredths, 0) !== 10_000) return { error: "The shares must add up to 100%." };
  const chains: ChainShare[] = [];
  for (const s of used) {
    const book = books.find((b) => b.chainId === s.chainId);
    const rows = book?.rows ?? [];
    const amount = (power * s.hundredths) / 10_000;
    const split = bestSplit(rows.map((r) => ({ gauge: r.gauge as never, symbol: r.symbol, rate: r.feesUsdPerDay + r.incentivesUsdPerDay, weight: r.weight })), amount, 4);
    if (!split) return { error: `No gauge on ${s.name} has a fee estimate yet, so a share there can't be planned.` };
    // Each gauge's hundredths of the whole: its share of the chain times the chain's share, the rounding remainder to the largest.
    const partH = split.parts.map((p) => Math.floor((Math.round(p.pct * 100) * s.hundredths) / 10_000));
    const big = partH.indexOf(Math.max(...partH));
    partH[big] += s.hundredths - partH.reduce((a, b) => a + b, 0);
    chains.push({
      chainId: s.chainId,
      name: s.name,
      pct: s.hundredths / 100,
      usdPerDay: split.usdPerDay,
      feeUsd: 0,
      parts: split.parts.map((p, i) => ({ symbol: p.symbol, gauge: String(p.gauge), pct: partH[i] / 100, usdPerDay: p.usdPerDay })),
    });
  }
  return { chains: chains.sort((a, b) => b.pct - a.pct), usdPerDay: chains.reduce((s, c) => s + c.usdPerDay, 0) };
}
