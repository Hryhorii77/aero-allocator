import { bestSplit } from "./split";
import type { ChainBook, ChainShare } from "./all-chains-split";

export interface CustomShare {
  chainId: number;
  name: string;
  /** Share of the whole position, in hundredths of a percent (3000 = 30%). */
  hundredths: number;
}

/** Gauges the owner picked on a chain, each with its share of that chain in hundredths of a percent (adding up to 10,000). */
export type ManualPicks = Record<number, Array<{ gauge: string; hundredths: number }>>;

/** Parses typed gauge shares ("60", "12.5") for one chain; an error text when a share isn't a number or they don't add up to 100%. */
export function parseManualPicks(typed: Record<string, string>): { picks: Array<{ gauge: string; hundredths: number }> } | { error: string } | null {
  const entries = Object.entries(typed);
  if (entries.length === 0) return null;
  const picks = entries.map(([gauge, text]) => ({ gauge, hundredths: percentToHundredths(text) }));
  if (picks.some((p) => p.hundredths === null || p.hundredths === 0)) return { error: "Give every gauge you picked a share above 0, as a percentage with at most two decimals." };
  const sum = picks.reduce((a, p) => a + (p.hundredths as number), 0);
  if (sum !== 10_000) return { error: `The gauges you picked add up to ${(sum / 100).toFixed(2).replace(/\.00$/, "")}%, not 100%.` };
  return { picks: picks as Array<{ gauge: string; hundredths: number }> };
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
export function customChainSplit(shares: CustomShare[], power: number, books: ChainBook[], manual: ManualPicks = {}): CustomResult {
  const used = shares.filter((s) => s.hundredths > 0);
  if (used.length === 0) return { error: "Give at least one chain a share." };
  if (used.reduce((s, x) => s + x.hundredths, 0) !== 10_000) return { error: "The shares must add up to 100%." };
  const chains: ChainShare[] = [];
  for (const s of used) {
    const book = books.find((b) => b.chainId === s.chainId);
    const rows = book?.rows ?? [];
    const amount = (power * s.hundredths) / 10_000;
    const chosen = manual[s.chainId];
    let parts: Array<{ symbol: string; gauge: string; pctOfChain: number; usdPerDay: number }>;
    if (chosen && chosen.length > 0) {
      // The owner's own gauges: each must be one we can rank here, and the shares must add up.
      if (chosen.reduce((a, c) => a + c.hundredths, 0) !== 10_000) return { error: `The gauges you picked on ${s.name} must add up to 100%.` };
      const picked = chosen.map((c) => ({ c, row: rows.find((r) => r.gauge.toLowerCase() === c.gauge.toLowerCase()) }));
      const unknown = picked.find((x) => !x.row);
      if (unknown) return { error: `A gauge you picked on ${s.name} has no fee estimate yet, so it can't be planned.` };
      parts = picked.map(({ c, row }) => {
        const a = (amount * c.hundredths) / 10_000;
        const rate = row!.feesUsdPerDay + row!.incentivesUsdPerDay;
        return { symbol: row!.symbol, gauge: c.gauge, pctOfChain: c.hundredths / 100, usdPerDay: (rate * a) / (row!.weight + a) };
      });
    } else {
      const split = bestSplit(rows.map((r) => ({ gauge: r.gauge as never, symbol: r.symbol, rate: r.feesUsdPerDay + r.incentivesUsdPerDay, weight: r.weight })), amount, 4);
      if (!split) return { error: `No gauge on ${s.name} has a fee estimate yet, so a share there can't be planned.` };
      parts = split.parts.map((p) => ({ symbol: p.symbol, gauge: String(p.gauge), pctOfChain: p.pct, usdPerDay: p.usdPerDay }));
    }
    // Each gauge's hundredths of the whole: its share of the chain times the chain's share, the rounding remainder to the largest.
    const partH = parts.map((p) => Math.floor((Math.round(p.pctOfChain * 100) * s.hundredths) / 10_000));
    const big = partH.indexOf(Math.max(...partH));
    partH[big] += s.hundredths - partH.reduce((a, b) => a + b, 0);
    chains.push({
      chainId: s.chainId,
      name: s.name,
      pct: s.hundredths / 100,
      usdPerDay: parts.reduce((a, p) => a + p.usdPerDay, 0),
      feeUsd: 0,
      parts: parts.map((p, i) => ({ symbol: p.symbol, gauge: p.gauge, pct: partH[i] / 100, usdPerDay: p.usdPerDay })),
    });
  }
  return { chains: chains.sort((a, b) => b.pct - a.pct), usdPerDay: chains.reduce((s, c) => s + c.usdPerDay, 0) };
}
