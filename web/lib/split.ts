import type { YieldRow } from "./gauge-yield";

/** One gauge in a recommended split. */
export interface SplitPart {
  gauge: YieldRow["gauge"];
  symbol: string;
  /** Share of the amount, 0-100 (hundredths of a percent, adding up to exactly 100). */
  pct: number;
  /** Power placed in this gauge, whole tokens. */
  amount: number;
  /** What that amount earns here per day after joining the gauge's weight. */
  usdPerDay: number;
}

export interface Split {
  parts: SplitPart[];
  /** Total USD per day of the split. */
  usdPerDay: number;
  /** Total USD per day if everything went to the single best gauge. */
  bestSingleUsdPerDay: number;
}

const MIN_PART_PCT = 1;

/**
 * Splits `amount` across gauges to earn the most per day. A gauge pays `rate` USD/day (fees + incentives) to everyone in it, so
 * putting `a` into a gauge that already holds `weight` earns rate * a / (weight + a): each extra dollar of power earns less than the
 * last. The best split equalises the marginal return across the gauges used (water-filling), found by bisection on that marginal
 * return. Gauges that would get less than 1% are dropped and the rest re-solved, up to `maxParts` gauges.
 */
export function bestSplit(
  gauges: Array<{ gauge: YieldRow["gauge"]; symbol: string; rate: number; weight: number }>,
  amount: number,
  maxParts = 6,
): Split | null {
  const pool = gauges.filter((g) => g.rate > 0 && g.weight > 0);
  if (!(amount > 0) || pool.length === 0) return null;
  const earn = (g: { rate: number; weight: number }, a: number) => (a > 0 ? (g.rate * a) / (g.weight + a) : 0);
  const bestSingle = Math.max(...pool.map((g) => earn(g, amount)));

  // Allocation at marginal return `lambda`: a = sqrt(rate * weight / lambda) - weight, floored at 0.
  const solve = (set: typeof pool): number[] => {
    let lo = 0;
    let hi = Math.max(...set.map((g) => g.rate / g.weight));
    for (let i = 0; i < 200; i++) {
      const mid = (lo + hi) / 2 || hi / 2;
      const total = set.reduce((s, g) => s + Math.max(0, Math.sqrt((g.rate * g.weight) / mid) - g.weight), 0);
      if (total > amount) lo = mid;
      else hi = mid;
    }
    const lambda = hi;
    const raw = set.map((g) => Math.max(0, Math.sqrt((g.rate * g.weight) / lambda) - g.weight));
    const sum = raw.reduce((a, b) => a + b, 0);
    return sum > 0 ? raw.map((a) => (a / sum) * amount) : raw;
  };

  let set = [...pool].sort((a, b) => b.rate / b.weight - a.rate / a.weight).slice(0, 40);
  let amounts = solve(set);
  for (let round = 0; round < 8; round++) {
    const keep = set
      .map((g, i) => ({ g, a: amounts[i] }))
      .filter((x) => (x.a / amount) * 100 >= MIN_PART_PCT)
      .sort((x, y) => y.a - x.a)
      .slice(0, maxParts)
      .map((x) => x.g);
    if (keep.length === 0) return null;
    if (keep.length === set.length) break;
    set = keep;
    amounts = solve(set);
  }

  // Hundredths of a percent that add up to exactly 100; the remainder goes to the biggest part.
  const hundredths = amounts.map((a) => Math.floor((a / amount) * 10_000));
  const big = amounts.indexOf(Math.max(...amounts));
  hundredths[big] += 10_000 - hundredths.reduce((a, b) => a + b, 0);
  const parts = set
    .map((g, i): SplitPart => {
      const a = (hundredths[i] / 10_000) * amount;
      return { gauge: g.gauge, symbol: g.symbol, pct: hundredths[i] / 100, amount: a, usdPerDay: earn(g, a) };
    })
    .filter((p) => p.pct > 0)
    .sort((a, b) => b.pct - a.pct);
  return { parts, usdPerDay: parts.reduce((s, p) => s + p.usdPerDay, 0), bestSingleUsdPerDay: bestSingle };
}
