import type { Analysis } from "./position-advice";

const usd2 = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export interface OpportunityLine {
  /** One plain sentence about this position, or null when there is nothing to say (no power, no ranking). */
  text: string | null;
  /** USD/day this position leaves on the table by not moving; 0 unless the advice is to switch or to allocate idle power. */
  costUsdPerDay: number;
}

/**
 * What staying put costs a position, in dollars a day, from the same analysis the paid API runs. Only a move the advice calls worth
 * it counts: a gain that rests on thin fee history, or is too small to beat the 47-hour wait, is not "lost" money.
 */
export function opportunityLine(a: Analysis): OpportunityLine {
  const best = a.best;
  switch (a.advice.action) {
    case "allocate":
      if (!best) return { text: null, costUsdPerDay: 0 };
      // A position too small to earn a cent a day gets no figure: "$0.00" says nothing.
      return best.usdPerDay >= 0.01
        ? { text: `Idle, so it earns nothing now. The best split would earn about $${usd2(best.usdPerDay)} a day.`, costUsdPerDay: best.usdPerDay }
        : { text: "Idle, so it earns nothing now.", costUsdPerDay: 0 };
    case "switch":
      return best && a.currentUsdPerDay !== null && a.gainUsdPerDay !== null
        ? {
            text: `Earns about $${usd2(a.currentUsdPerDay)} a day where it is. The best split would earn about $${usd2(best.usdPerDay)}, so staying costs about $${usd2(a.gainUsdPerDay)} a day.`,
            costUsdPerDay: a.gainUsdPerDay,
          }
        : { text: null, costUsdPerDay: 0 };
    case "stay":
      if (!best || a.currentUsdPerDay === null) return { text: null, costUsdPerDay: 0 };
      return {
        text:
          best.usdPerDay > a.currentUsdPerDay
            ? `Earns about $${usd2(a.currentUsdPerDay)} a day. The best split would earn about $${usd2(best.usdPerDay)}, not enough more to be worth the 47-hour wait.`
            : `Earns about $${usd2(a.currentUsdPerDay)} a day, as much as the best split would.`,
        costUsdPerDay: 0,
      };
    case "unknown":
      return { text: a.advice.reason, costUsdPerDay: 0 };
    default:
      return { text: null, costUsdPerDay: 0 };
  }
}

/** The sentence over the whole list: what the positions that should move would earn more, per day and over 30 days. */
export function totalCostText(costsUsdPerDay: number[]): string | null {
  const total = costsUsdPerDay.reduce((a, b) => a + b, 0);
  if (!(total >= 0.01)) return null;
  return `Moving the positions that should move would earn about $${usd2(total)} a day more (about $${usd2(total * 30)} over 30 days) at today's fee pace. An estimate, not a promise.`;
}
