/**
 * What a *specific* locker's current vote is worth versus what the
 * recommended split would pay — the per-address delta.
 *
 * This is deliberately engine-level rather than a React helper. Three
 * callers need the identical arithmetic and must not drift apart:
 *
 *   1. the dashboard's connect-wallet diff (web/app/page.tsx),
 *   2. the paid /api/v1/position endpoint, which sells exactly this number,
 *   3. scripts/lockers.ts, which runs it across every veNFT to size the
 *      market before anything gets priced.
 *
 * If (1) and (2) disagreed by a cent, the free page would be contradicting
 * the paid answer about the same wallet, which is worse than either being
 * slightly wrong.
 */

/** A veNFT's current on-chain vote split, each weight as a percentage of
 * that NFT's own total (veSugar's VeNFT.votes, normalized). */
export interface CurrentVoteWeight {
  pool: string;
  weightPct: number;
}

/** The minimum an allocation row needs to expose for this comparison. */
export interface RecommendedWeight {
  pool: string;
  symbol: string;
  weightPct: number;
  /** Expected USD next epoch for the votes this row allocates, after dilution. */
  expectedRewardUsd?: number;
}

/** Per-pool figures the "stay" side prices against. */
export interface PoolRate {
  symbol: string;
  rewardPer1kVotesUsd: number;
}

export interface PositionRow {
  pool: string;
  symbol: string;
  currentPct: number;
  recommendedPct: number;
  /** undefined when this pool isn't in the analyzed set — see `comparable`. */
  rewardPer1kVotesUsd?: number;
}

export interface PositionDelta {
  rows: PositionRow[];
  currentPoolCount: number;
  recommendedPoolCount: number;
  /** Approximated from each held pool's last-epoch $/1k rate. */
  estimateIfStayUsd: number;
  /** The recommendation's own next-epoch predictive model. */
  estimateIfSwitchUsd: number;
  /** switch − stay, differenced after rounding each side to the cent. */
  deltaUsd: number;
  /**
   * False when a pool the voter currently holds has no $/1k rate available,
   * which makes the "stay" side an undercount by exactly the amount we
   * couldn't measure — and so would flatter switching. Callers must withhold
   * the delta rather than print a number biased in their own favour.
   */
  comparable: boolean;
  /** Which held pools had no rate, when `comparable` is false. */
  unpricedPools: string[];
  /** True when the veNFT hasn't voted this epoch — nothing to compare. */
  hasVoted: boolean;
}

const round2 = (x: number) => Math.round(x * 100) / 100;

/**
 * Collapses several veNFTs' individual splits into one portfolio-wide split,
 * each weighted by its own voting power.
 *
 * "What am I already in, in aggregate" is the question a multi-lock holder
 * actually has — not N separate per-NFT answers they'd have to combine
 * themselves. Mirrors web/app/wallet.tsx's selectNfts blending; kept here so
 * the paid endpoint and the dashboard can't answer differently for the same
 * wallet.
 */
export function blendVotes(
  locks: Array<{ votingPower: number; votes: CurrentVoteWeight[] }>,
): { votingPower: number; votes: CurrentVoteWeight[] } {
  const votingPower = locks.reduce((s, l) => s + l.votingPower, 0);
  if (votingPower <= 0) return { votingPower: 0, votes: [] };

  const poolAmounts = new Map<string, number>();
  for (const lock of locks) {
    for (const v of lock.votes) {
      const key = v.pool.toLowerCase();
      poolAmounts.set(key, (poolAmounts.get(key) ?? 0) + lock.votingPower * (v.weightPct / 100));
    }
  }
  return {
    votingPower,
    votes: [...poolAmounts.entries()].map(([pool, amount]) => ({
      pool,
      weightPct: (amount / votingPower) * 100,
    })),
  };
}

/**
 * The two $ estimates are NOT apples-to-apples, by necessity, and every
 * caller has to say so:
 *
 * - "if you switch" reuses the recommendation's own next-epoch predictive
 *   model (expectedRewardUsd).
 * - "if you stay" has no such model to reuse — there is no forecast of "what
 *   this voter's existing split pays", only of what each pool pays. So it
 *   approximates: each held pool's last-epoch $/1k rate × the votes this
 *   voter has there.
 *
 * Pretending these share a basis would be a new, invisible way to mislead.
 * Being explicit about the difference isn't.
 */
export function computePositionDelta(args: {
  currentVotes: CurrentVoteWeight[];
  votingPower: number;
  recommended: RecommendedWeight[];
  poolRates: Map<string, PoolRate>;
}): PositionDelta {
  const { currentVotes, votingPower, recommended, poolRates } = args;

  const recommendedByPool = new Map(recommended.map((a) => [a.pool.toLowerCase(), a]));
  const allPools = new Set([
    ...currentVotes.map((v) => v.pool.toLowerCase()),
    ...recommended.map((a) => a.pool.toLowerCase()),
  ]);

  const rows: PositionRow[] = Array.from(allPools)
    .map((pool) => {
      const current = currentVotes.find((v) => v.pool.toLowerCase() === pool);
      const rec = recommendedByPool.get(pool);
      const rate = poolRates.get(pool);
      return {
        pool,
        symbol: rate?.symbol ?? rec?.symbol ?? `${pool.slice(0, 8)}…`,
        currentPct: current?.weightPct ?? 0,
        recommendedPct: rec?.weightPct ?? 0,
        rewardPer1kVotesUsd: rate?.rewardPer1kVotesUsd,
      };
    })
    .sort((a, b) => b.recommendedPct - a.recommendedPct || b.currentPct - a.currentPct);

  let estimateIfStayUsd = 0;
  const unpricedPools: string[] = [];
  for (const r of rows) {
    if (r.currentPct <= 0) continue;
    if (r.rewardPer1kVotesUsd === undefined) {
      unpricedPools.push(r.pool);
      continue;
    }
    const yourVotes = votingPower * (r.currentPct / 100);
    estimateIfStayUsd += r.rewardPer1kVotesUsd * (yourVotes / 1000);
  }
  const estimateIfSwitchUsd = recommended.reduce((s, a) => s + (a.expectedRewardUsd ?? 0), 0);

  // Differenced after rounding, not before: both sides get printed to the
  // cent by every caller, and a delta taken from the raw values can land a
  // cent off what subtracting those two printed figures gives — which reads
  // as a bug to anyone who checks the arithmetic.
  const deltaUsd = round2(estimateIfSwitchUsd) - round2(estimateIfStayUsd);

  return {
    rows,
    currentPoolCount: rows.filter((r) => r.currentPct > 0).length,
    recommendedPoolCount: rows.filter((r) => r.recommendedPct > 0).length,
    estimateIfStayUsd,
    estimateIfSwitchUsd,
    deltaUsd,
    comparable: unpricedPools.length === 0,
    unpricedPools,
    hasVoted: currentVotes.length > 0,
  };
}
