import { simulateBribeImpact, type MarketSnapshot } from "./scoring.js";

/**
 * The bribe simulator run backwards: instead of "what does $X pull toward
 * this pool", "what is the least that could pull it to Y% of all votes".
 *
 * Read the answer as a FLOOR, not a quote. simulateBribeImpact models an
 * instant, frictionless re-optimization of the whole market's votes by payout
 * and says of itself that it's a theoretical ceiling on what a bribe pulls.
 * Inverting a ceiling on votes gives a lower bound on cost: the real bribe
 * needed to hit a share is at least this, and usually more, because real
 * voters move slowly and not all of them follow payout. That's still useful
 * to a protocol — it says which targets are hopeless at a given budget and
 * which pool is cheapest to move — but selling it as "the bribe you need"
 * would be how someone under-bribes and blames the tool.
 */
export interface BribeTargetResult {
  pool: string;
  symbol: string;
  targetVoteSharePct: number;
  /** The pool's share of all eligible votes with no extra bribe, under the same model. */
  baselineVoteSharePct: number;
  /** False when the target can't be reached at any budget (see `reason`). */
  feasible: boolean;
  /** Least additional bribe, USD, the model needs to reach the target; null when infeasible. */
  minBribeUsd: number | null;
  /** Share reached at minBribeUsd (>= the target, to the cent's precision). */
  projectedVoteSharePct: number | null;
  /** Extra votes that share represents, veAERO units. */
  votesNeeded: number | null;
  /** Effective cost per 1,000 incremental votes at that budget. */
  usdPer1kIncrementalVotes: number | null;
  /** Bribes already posted on this pool this epoch, USD — what the floor is on top of. */
  postedBribesUsd: number;
  /** Floor at points between the baseline and the target, so the price of each extra point of share is visible. */
  costCurve: Array<{ targetVoteSharePct: number; minBribeUsd: number }>;
  reason?: string;
  basis: string;
}

const BASIS =
  "A model floor, not a quote: the least a bribe could cost if the whole market's votes re-optimized by payout " +
  "instantly and frictionlessly (the bribe simulator's assumptions, run backwards). Real voters move slower, so " +
  "budget above this. Use it to compare pools and rule out hopeless targets, not as the amount to post.";

const MAX_BUDGET_USD = 1e9;
const CENT = 0.01;

/** Smallest budget (to the cent) whose projected share reaches `targetPct`, or null if no budget does. */
function solveBudget(snapshot: MarketSnapshot, pool: string, targetPct: number, maxWeightFraction: number): number | null {
  const share = (budget: number) => simulateBribeImpact(snapshot, pool, budget, maxWeightFraction).projectedVoteSharePct;

  // Grow the ceiling until it clears the target — a cap or saturation can
  // make the target unreachable at any price, which is an answer, not an error.
  let hi = 1;
  while (share(hi) < targetPct) {
    hi *= 2;
    if (hi > MAX_BUDGET_USD) return null;
  }
  let lo = 0;
  for (let i = 0; i < 60 && hi - lo > CENT / 2; i++) {
    const mid = (lo + hi) / 2;
    if (share(mid) >= targetPct) hi = mid;
    else lo = mid;
  }
  return Math.ceil(hi / CENT) * CENT;
}

const round2 = (x: number) => Math.round(x * 100) / 100;

export function minimumBribeForTarget(
  snapshot: MarketSnapshot,
  pool: string,
  targetVoteSharePct: number,
  maxWeightFraction = 0.35,
): BribeTargetResult {
  if (!(targetVoteSharePct > 0 && targetVoteSharePct <= 100)) {
    throw new Error("targetVoteSharePct must be a number above 0 and at most 100.");
  }
  // Throws (unknown / ineligible pool) exactly as the simulator does.
  const base = simulateBribeImpact(snapshot, pool, 0, maxWeightFraction);
  const forecast = snapshot.forecasts.find((f) => f.pool.lp.toLowerCase() === pool.toLowerCase());
  const common = {
    pool: base.pool,
    symbol: base.symbol,
    targetVoteSharePct,
    baselineVoteSharePct: base.baselineVoteSharePct,
    postedBribesUsd: round2(forecast?.currentBribesUsd ?? 0),
    basis: BASIS,
  };

  if (targetVoteSharePct <= base.baselineVoteSharePct) {
    return {
      ...common,
      feasible: true,
      minBribeUsd: 0,
      projectedVoteSharePct: base.baselineVoteSharePct,
      votesNeeded: 0,
      usdPer1kIncrementalVotes: null,
      costCurve: [],
      reason: "The pool already has at least that share under the model; no extra bribe needed.",
    };
  }

  const budget = solveBudget(snapshot, pool, targetVoteSharePct, maxWeightFraction);
  if (budget === null) {
    return {
      ...common,
      feasible: false,
      minBribeUsd: null,
      projectedVoteSharePct: null,
      votesNeeded: null,
      usdPer1kIncrementalVotes: null,
      costCurve: [],
      reason:
        `The model can't reach ${targetVoteSharePct}% at any budget: no pool takes more than ` +
        `${Math.round(maxWeightFraction * 100)}% of votes (the same concentration cap voter_roi uses).`,
    };
  }

  const at = simulateBribeImpact(snapshot, pool, budget, maxWeightFraction);
  const gap = targetVoteSharePct - base.baselineVoteSharePct;
  const costCurve = [0.25, 0.5, 0.75, 1].flatMap((f) => {
    const pct = round2(base.baselineVoteSharePct + gap * f);
    const cost = f === 1 ? budget : solveBudget(snapshot, pool, pct, maxWeightFraction);
    return cost === null ? [] : [{ targetVoteSharePct: pct, minBribeUsd: round2(cost) }];
  });

  return {
    ...common,
    feasible: true,
    minBribeUsd: round2(budget),
    projectedVoteSharePct: at.projectedVoteSharePct,
    votesNeeded: at.voteGain,
    usdPer1kIncrementalVotes: at.usdPer1kIncrementalVotes,
    costCurve,
  };
}
