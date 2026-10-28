import type { Address } from "viem";
import { bestSplit, type SplitPart } from "./split";
import { BASE_CHAIN } from "./aero-chains";
import { paceConfidence } from "./gauge-yield";

/** What one chain offers an amount: its ranked gauges (from `rankByUsdPerDay`, so thin, light and unpriced gauges are already out). */
export interface ChainBook {
  chainId: number;
  name: string;
  rows: Array<{ gauge: string; symbol: string; feesUsdPerDay: number; incentivesUsdPerDay: number; weight: number; windowHours: number; spike?: unknown }>;
}

export interface ChainShare {
  chainId: number;
  name: string;
  /** Share of the whole amount placed on this chain, 0-100. */
  pct: number;
  usdPerDay: number;
  /** One-off ETH cost of sending power here (0 on Base). */
  feeUsd: number;
  parts: Array<{ symbol: string; gauge: string; pct: number; usdPerDay: number }>;
}

export interface AcrossChains {
  chains: ChainShare[];
  usdPerDay: number;
  feeUsd: number;
  /** What it earns over the horizon, minus the one-off fees. */
  netUsd: number;
  weakestHours: number;
  spiky: boolean;
  confidence: "thin" | "fair" | "solid" | "spiky";
}

export interface AcrossResult {
  best: AcrossChains;
  /** The best split using Base only, over the same horizon (no cross-chain fee). */
  baseOnly: AcrossChains | null;
}

const key = (chainId: number, gauge: string) => `${chainId}:${gauge.toLowerCase()}`;

function evaluate(books: ChainBook[], amount: number, days: number, feeUsd: (chainId: number, gauges: number) => number): AcrossChains | null {
  const spikeOf = new Map<string, boolean>();
  const hoursOf = new Map<string, number>();
  const pool = books.flatMap((b) =>
    b.rows.map((r) => {
      const k = key(b.chainId, r.gauge);
      spikeOf.set(k, !!r.spike);
      hoursOf.set(k, r.windowHours);
      return { gauge: k as unknown as Address, symbol: r.symbol, rate: r.feesUsdPerDay + r.incentivesUsdPerDay, weight: r.weight };
    }),
  );
  const split = bestSplit(pool, amount);
  if (!split) return null;
  const chains: ChainShare[] = [];
  for (const b of books) {
    const parts = split.parts.filter((p) => String(p.gauge).startsWith(`${b.chainId}:`));
    if (parts.length === 0) continue;
    chains.push({
      chainId: b.chainId,
      name: b.name,
      pct: round2(parts.reduce((s, p) => s + p.pct, 0)),
      usdPerDay: parts.reduce((s, p) => s + p.usdPerDay, 0),
      feeUsd: b.chainId === BASE_CHAIN.id ? 0 : feeUsd(b.chainId, parts.length),
      parts: parts.map((p: SplitPart) => ({ symbol: p.symbol, gauge: String(p.gauge).split(":")[1], pct: p.pct, usdPerDay: p.usdPerDay })),
    });
  }
  chains.sort((a, b) => b.pct - a.pct);
  const fee = chains.reduce((s, c) => s + c.feeUsd, 0);
  const weakestHours = split.parts.reduce((h, p) => Math.min(h, hoursOf.get(String(p.gauge)) ?? 0), Infinity);
  const spiky = split.parts.some((p) => spikeOf.get(String(p.gauge)));
  return { chains, usdPerDay: split.usdPerDay, feeUsd: fee, netUsd: split.usdPerDay * days - fee, weakestHours, spiky, confidence: spiky ? "spiky" : paceConfidence(weakestHours) };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * The best way to split `amount` over every gauge on every chain, counting what each chain costs to reach. Each gauge pays the same
 * way wherever it is (fees and incentives shared by the power in it), so the maths is the per-chain split over the union of gauges;
 * what differs is that every chain other than Base needs a one-off ETH fee. So every set of chains is tried, each at its best split, and
 * the set that earns the most over `days`, after those fees, wins. Base alone is always one of the sets and is returned for comparison.
 */
export function bestAcrossChains(books: ChainBook[], amount: number, days: number, feeUsd: (chainId: number, gauges: number) => number): AcrossResult | null {
  const live = books.filter((b) => b.rows.length > 0);
  if (!(amount > 0) || !(days > 0) || live.length === 0) return null;
  let best: AcrossChains | null = null;
  for (let mask = 1; mask < 1 << live.length; mask++) {
    const set = live.filter((_, i) => mask & (1 << i));
    const r = evaluate(set, amount, days, feeUsd);
    if (r && (!best || r.netUsd > best.netUsd)) best = r;
  }
  if (!best) return null;
  const base = live.find((b) => b.chainId === BASE_CHAIN.id);
  return { best, baseOnly: base ? evaluate([base], amount, days, feeUsd) : null };
}
