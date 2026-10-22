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
  const feeOf = new Map(fees.map((f) => [f.gauge.toLowerCase(), f.feesUsdPerDay]));
  const rows: YieldRow[] = [];
  for (const g of gauges) {
    const f = feeOf.get(g.gauge.toLowerCase());
    if (f === undefined || g.weight < minWeight || !g.activated) continue;
    const incentivesUsdPerDay = g.incentivesUsdPerWeek / 7;
    const share = amount / (g.weight + amount);
    rows.push({
      gauge: g.gauge,
      symbol: g.symbol,
      feesUsdPerDay: f,
      incentivesUsdPerDay,
      usdPerDay: (f + incentivesUsdPerDay) * share,
      sharePct: share * 100,
    });
  }
  return rows.sort((a, b) => b.usdPerDay - a.usdPerDay);
}
