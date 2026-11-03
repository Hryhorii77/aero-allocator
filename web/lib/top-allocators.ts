import type { YieldRow } from "./gauge-yield";
import { splitRate } from "./split";

// The biggest sAERO positions and how they split their Base power, so a holder can see (and copy) what large allocators do.
// Everything here is public chain data; positions are shown by id only, never by owner. A big position spreads out to avoid
// diluting itself, so its split is priced for the viewer's own amount next to the best split before anyone copies it.

/** How many of the largest positions are listed. */
export const TOP_ALLOCATORS = 10;

export interface TopAllocator {
  tokenId: string;
  /** Voting power, whole tokens. */
  power: number;
  /** Power allocated to Base gauges, whole tokens (the rest is idle or on other chains). */
  onBase: number;
  /** The Base split: each gauge's share of the position's Base allocation, in percent with two decimals, adding up to exactly 100. */
  parts: Array<{ gauge: string; pct: number }>;
  /** True when the position is one of Aero Autopilot's pools (its owner was made by Autopilot's factory). */
  autopilot?: boolean;
}

export interface TopAllocators {
  generatedAt: number;
  /** Total voting power of every position, whole tokens, so a position's size can be read as a share. */
  totalPower: number;
  allocators: TopAllocator[];
}

/** The `n` largest positions by power, largest first; ties keep the lower id first. Zero-power positions are left out. */
export function topByPower(powers: Array<{ tokenId: number; power: number }>, n = TOP_ALLOCATORS): Array<{ tokenId: number; power: number }> {
  return powers
    .filter((p) => p.power > 0)
    .sort((a, b) => b.power - a.power || a.tokenId - b.tokenId)
    .slice(0, n);
}

/**
 * Each gauge's share of the given amounts as percentages with two decimals that add up to exactly 100 (largest remainder), largest first.
 * The allocate flow needs an exact 100%, and flooring each share (what a plain division does) can leave it at 99.99.
 */
export function copyShares(amounts: Array<{ gauge: string; raw: bigint }>): Array<{ gauge: string; pct: number }> {
  const live = amounts.filter((a) => a.raw > 0n && !/^0x0+$/.test(a.gauge));
  const total = live.reduce((s, a) => s + a.raw, 0n);
  if (total === 0n) return [];
  const exact = live.map((a) => ({ gauge: a.gauge, hundredths: (a.raw * 10_000n) / total, rem: (a.raw * 10_000n) % total }));
  let left = 10_000n - exact.reduce((s, e) => s + e.hundredths, 0n);
  for (const e of [...exact].sort((x, y) => (y.rem > x.rem ? 1 : y.rem < x.rem ? -1 : 0))) {
    if (left <= 0n) break;
    e.hundredths += 1n;
    left -= 1n;
  }
  return exact
    .filter((e) => e.hundredths > 0n)
    .map((e) => ({ gauge: e.gauge, pct: Number(e.hundredths) / 100 }))
    .sort((a, b) => b.pct - a.pct);
}

/**
 * What `amount` would earn per day on a copied split, priced like the site's own splits (`splitRate`: a burst counts at its usual level,
 * after your amount joins each gauge's weight). Gauges with no fee estimate earn nothing here and are listed in `unpriced`.
 */
export function priceCopy(
  parts: Array<{ gauge: string; pct: number }>,
  rows: Array<Pick<YieldRow, "gauge" | "feesUsdPerDay" | "incentivesUsdPerDay" | "spike" | "weight">>,
  amount: number,
): { usdPerDay: number; unpriced: number } {
  const byGauge = new Map(rows.map((r) => [r.gauge.toLowerCase(), r]));
  let usd = 0;
  let unpriced = 0;
  for (const p of parts) {
    const r = byGauge.get(p.gauge.toLowerCase());
    if (!r) {
      unpriced += 1;
      continue;
    }
    const a = (amount * p.pct) / 100;
    usd += (splitRate(r) * a) / (r.weight + a);
  }
  return { usdPerDay: usd, unpriced };
}
