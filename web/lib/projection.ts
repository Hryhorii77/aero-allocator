import type { YieldRow } from "./gauge-yield";
import type { Split } from "./split";

/** Fees never count for less than this share of their recent pace in the low case: a gauge that pays at all keeps paying something. */
export const LOW_FEE_FLOOR = 0.5;

export interface Range {
  /** USD/day with each gauge's fees cut to its share of paying half-days (at least half), incentives unchanged. */
  lowUsdPerDay: number;
  /** USD/day at the recent fee pace: the best split's own figure. */
  paceUsdPerDay: number;
}

/**
 * A range for a split instead of one number. Fee releases are lumpy, so the recent pace can overstate a quiet stretch. The low end
 * keeps the same split but counts each gauge's fees at the share of its complete half-days that paid at least half the average (half
 * when the record is too short to say), and leaves incentives alone because they stream at a fixed rate. There is no high end: the
 * recent pace is the best the data supports, and calling anything above it a forecast would be a guess.
 */
export function projectRange(ranked: YieldRow[], split: Split): Range {
  const byGauge = new Map(ranked.map((r) => [r.gauge.toLowerCase(), r]));
  let low = 0;
  for (const part of split.parts) {
    const row = byGauge.get(part.gauge.toLowerCase());
    if (!row) {
      low += part.usdPerDay;
      continue;
    }
    const factor = row.steady && row.steady.buckets > 0 ? Math.max(LOW_FEE_FLOOR, row.steady.paying / row.steady.buckets) : LOW_FEE_FLOOR;
    low += ((row.feesUsdPerDay * factor + row.incentivesUsdPerDay) * part.amount) / (row.weight + part.amount);
  }
  return { lowUsdPerDay: Math.min(low, split.usdPerDay), paceUsdPerDay: split.usdPerDay };
}
