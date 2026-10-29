import type { YieldRow } from "./gauge-yield";
import type { Split } from "./split";

/** Fees never count for less than this share of their recent pace in the low case: a gauge that pays at all keeps paying something. */
export const LOW_FEE_FLOOR = 0.5;

/** The share of a gauge's recent fee pace the low case counts: its share of paying half-days, never under half; half when the record is too short. */
export function lowFeeFactor(steady: YieldRow["steady"]): number {
  return steady && steady.buckets > 0 ? Math.max(LOW_FEE_FLOOR, steady.paying / steady.buckets) : LOW_FEE_FLOOR;
}

/**
 * Fees per day the low case counts for a gauge: its usual level when the recent pace is a spike, otherwise the pace cut by its paying
 * share. Never above the pace.
 */
export function lowFeesUsdPerDay(row: Pick<YieldRow, "feesUsdPerDay" | "steady" | "spike">): number {
  const low = row.spike ? row.spike.typicalUsdPerDay : row.feesUsdPerDay * lowFeeFactor(row.steady);
  return Math.min(row.feesUsdPerDay, low);
}

/** Incentives per day the low case counts: what they average over the wait, counting each program only until it ends (what streams now when the end times are unknown). */
export function lowIncentivesUsdPerDay(row: Pick<YieldRow, "incentivesUsdPerDay" | "incentivesLowUsdPerDay">): number {
  return Math.min(row.incentivesUsdPerDay, row.incentivesLowUsdPerDay ?? row.incentivesUsdPerDay);
}

export interface Range {
  /** USD/day with each gauge's fees cut to its share of paying half-days (at least half) and its incentives averaged over the wait. */
  lowUsdPerDay: number;
  /** USD/day at the recent fee pace: the best split's own figure. */
  paceUsdPerDay: number;
}

/**
 * A range for a split instead of one number. Fee releases are lumpy, so the recent pace can overstate a quiet stretch. The low end
 * keeps the same split but counts each gauge's fees at the share of its complete half-days that paid at least half the average (half
 * when the record is too short to say), or at its usual level when its pace is a spike, and averages each gauge's incentives over the wait, because a program that ends inside it stops paying (they stream at a fixed rate until then). There is no high end: the
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
    low += ((lowFeesUsdPerDay(row) + lowIncentivesUsdPerDay(row)) * part.amount) / (row.weight + part.amount);
  }
  return { lowUsdPerDay: Math.min(low, split.usdPerDay), paceUsdPerDay: split.usdPerDay };
}

/** The low case for one gauge row: what the amount behind `row.sharePct` would earn per day with fees at their low level. */
export function lowUsdPerDayOf(row: Pick<YieldRow, "feesUsdPerDay" | "incentivesUsdPerDay" | "incentivesLowUsdPerDay" | "sharePct" | "steady" | "spike">): number {
  return ((lowFeesUsdPerDay(row) + lowIncentivesUsdPerDay(row)) * row.sharePct) / 100;
}

/** The low case for where a position sits now: the same pricing as `currentUsdPerDay`, with each gauge's fees cut by `lowFeeFactor` and its incentives averaged over the wait. */
export function currentLowUsdPerDay(
  rows: Array<Pick<YieldRow, "gauge" | "feesUsdPerDay" | "incentivesUsdPerDay" | "incentivesLowUsdPerDay" | "weight" | "steady" | "spike">>,
  current: Array<{ gauge: string; pct: number }>,
  power: number,
): number {
  const byGauge = new Map(rows.map((r) => [r.gauge.toLowerCase(), r]));
  let usd = 0;
  for (const c of current) {
    const r = byGauge.get(c.gauge.toLowerCase());
    if (!r) continue;
    const own = (c.pct / 100) * power;
    usd += ((lowFeesUsdPerDay(r) + lowIncentivesUsdPerDay(r)) * own) / (r.weight + own);
  }
  return usd;
}
