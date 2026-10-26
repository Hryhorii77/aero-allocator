import type { Analysis } from "./position-advice";

const usd2 = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export interface OpportunityLine {
  /** One plain sentence about this position, or null when there is nothing to say (no power, no ranking). */
  text: string | null;
  /** USD/day this position leaves on the table by not moving, at today's fee pace; 0 unless the advice is to switch or to allocate idle power. */
  costUsdPerDay: number;
  /** The same in the low case (fees at their paying share, incentives unchanged); never above `costUsdPerDay`. */
  costLowUsdPerDay: number;
}

const NONE: OpportunityLine = { text: null, costUsdPerDay: 0, costLowUsdPerDay: 0 };
/** "$0.40 to $0.80" when the low case differs by a cent or more, else "$0.80". */
const span = (low: number, high: number) => (high - low >= 0.01 ? `$${usd2(low)} to $${usd2(high)}` : `$${usd2(high)}`);

/**
 * What staying put costs a position, in dollars a day, from the same analysis the paid API runs. Only a move the advice calls worth
 * it counts: a gain that rests on thin fee history, or is too small to beat the 47-hour wait, is not "lost" money.
 */
export function opportunityLine(a: Analysis): OpportunityLine {
  const best = a.best;
  switch (a.advice.action) {
    case "allocate":
      if (!best) return NONE;
      // A position too small to earn a cent a day gets no figure: "$0.00" says nothing.
      if (!(best.usdPerDay >= 0.01)) return { text: "Idle, so it earns nothing now.", costUsdPerDay: 0, costLowUsdPerDay: 0 };
      {
        const low = Math.min(best.usdPerDay, a.bestLowUsdPerDay ?? best.usdPerDay);
        return { text: `Idle, so it earns nothing now. The best split would earn about ${span(low, best.usdPerDay)} a day.`, costUsdPerDay: best.usdPerDay, costLowUsdPerDay: low };
      }
    case "switch":
      if (best && a.currentUsdPerDay !== null && a.gainUsdPerDay !== null) {
        const low = Math.min(a.gainUsdPerDay, a.gainLowUsdPerDay ?? a.gainUsdPerDay);
        const ranged = low < a.gainUsdPerDay - 0.005;
        return {
          text: `Earns about $${usd2(a.currentUsdPerDay)} a day where it is. The best split would earn about $${usd2(best.usdPerDay)}, so staying costs ${ranged ? `${span(low, a.gainUsdPerDay)} a day, depending on how the fees run` : `about $${usd2(a.gainUsdPerDay)} a day`}.`,
          costUsdPerDay: a.gainUsdPerDay,
          costLowUsdPerDay: low,
        };
      }
      return NONE;
    case "stay":
      if (!best || a.currentUsdPerDay === null) return NONE;
      return {
        text:
          best.usdPerDay > a.currentUsdPerDay
            ? `Earns about $${usd2(a.currentUsdPerDay)} a day. The best split would earn about $${usd2(best.usdPerDay)}, not enough more to be worth the 47-hour wait.`
            : `Earns about $${usd2(a.currentUsdPerDay)} a day, as much as the best split would.`,
        costUsdPerDay: 0,
        costLowUsdPerDay: 0,
      };
    case "unknown":
      return { text: a.advice.reason, costUsdPerDay: 0, costLowUsdPerDay: 0 };
    default:
      return NONE;
  }
}

/** The sentence over the whole list: what the positions that should move would earn more, per day and over 30 days, from the low case to today's pace. */
export function totalCostText(costs: Array<{ costUsdPerDay: number; costLowUsdPerDay: number }>): string | null {
  const high = costs.reduce((a, c) => a + c.costUsdPerDay, 0);
  if (!(high >= 0.01)) return null;
  const low = Math.min(high, costs.reduce((a, c) => a + c.costLowUsdPerDay, 0));
  const ranged = high - low >= 0.01;
  return ranged
    ? `Moving the positions that should move would earn about $${usd2(low)} to $${usd2(high)} a day more (about $${usd2(low * 30)} to $${usd2(high * 30)} over 30 days), from fees running light to today's pace. An estimate, not a promise.`
    : `Moving the positions that should move would earn about $${usd2(high)} a day more (about $${usd2(high * 30)} over 30 days) at today's fee pace. An estimate, not a promise.`;
}
