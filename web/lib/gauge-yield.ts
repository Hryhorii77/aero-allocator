import type { GaugeRow } from "./gauges";
import type { GaugeFee } from "./gauge-fees-read";

/** Gauges lighter than this (whole sAERO power) are not ranked: a few dollars of fees over almost no weight reads as a huge yield and vanishes once you add any size. */
export const MIN_RANK_WEIGHT = 100_000;

export interface YieldRow {
  gauge: GaugeRow["gauge"];
  symbol: string;
  /** Fees to voters, USD/day, at the recent pace. */
  feesUsdPerDay: number;
  /** Incentives streaming now, USD/day. */
  incentivesUsdPerDay: number;
  /** What `amount` of power would earn per day in this gauge after it joins the weight already there. */
  usdPerDay: number;
  /** Your share of the gauge's weight once you add `amount`, 0-100. */
  sharePct: number;
  /** Power already in the gauge, whole tokens. */
  weight: number;
  /** Pool kind ("CL100", "stable", "volatile"), to tell same-named gauges apart. */
  poolType?: string;
  /** How many hours of fee history the pace rests on. */
  windowHours: number;
  /** How many complete half-days paid at least half the average one; absent until there are three. */
  steady?: { buckets: number; paying: number };
}

/** Yearly return in percent for earning `usdPerDay` on `amount` AERO at `aeroUsd` each; null when the price or amount is missing. */
export function aprPct(usdPerDay: number, amount: number, aeroUsd: number | null | undefined): number | null {
  if (!aeroUsd || !(aeroUsd > 0) || !(amount > 0)) return null;
  return ((usdPerDay * 365) / (amount * aeroUsd)) * 100;
}

/** How much to trust a fee pace: a few hours of fee releases can swing a lot, a day or more is steadier. */
export function paceConfidence(windowHours: number): "thin" | "fair" | "solid" {
  return windowHours >= 24 ? "solid" : windowHours >= 6 ? "fair" : "thin";
}

/**
 * Dollars per day for `amount` of power in each gauge with a fee estimate: (fees + incentives) x amount / (weight + amount).
 * Your own allocation dilutes the gauge, so a small pool does not keep its headline yield as the amount grows.
 */
export function rankByUsdPerDay(
  gauges: GaugeRow[],
  fees: GaugeFee[],
  amount: number,
  minWeight: number = MIN_RANK_WEIGHT,
): YieldRow[] {
  if (!(amount > 0)) return [];
  const feeOf = new Map(fees.map((f) => [f.gauge.toLowerCase(), f]));
  const rows: YieldRow[] = [];
  for (const g of gauges) {
    const fee = feeOf.get(g.gauge.toLowerCase());
    const f = fee?.feesUsdPerDay;
    if (f === undefined || fee === undefined || g.weight < minWeight || !g.activated) continue;
    const incentivesUsdPerDay = g.incentivesUsdPerWeek / 7;
    const share = amount / (g.weight + amount);
    rows.push({
      gauge: g.gauge,
      symbol: g.symbol,
      feesUsdPerDay: f,
      incentivesUsdPerDay,
      usdPerDay: (f + incentivesUsdPerDay) * share,
      sharePct: share * 100,
      weight: g.weight,
      poolType: g.poolType,
      windowHours: fee.windowHours,
      ...(fee.steady ? { steady: fee.steady } : {}),
    });
  }
  return rows.sort((a, b) => b.usdPerDay - a.usdPerDay);
}
