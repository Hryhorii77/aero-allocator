import { SETTINGS, currentEpochStart, epochProgress } from "./config.js";
import { fetchHistories, scanPools, splitCurrentEpoch } from "./data.js";
import type {
  AllocationObjective,
  AllocationRecommendation,
  EpochStats,
  PoolForecast,
  PoolInfo,
} from "./types.js";

/**
 * Forecast next-epoch fees from a series of completed-epoch fees (newest first).
 * EWMA captures the level; a linear trend term captures momentum. This mirrors
 * the Predictive Allocation thesis: reward where demand is going, not where it was.
 */
export function forecastFees(completedNewestFirst: number[]): {
  predicted: number;
  trend: number;
  confidence: number;
} {
  const series = completedNewestFirst.filter((x) => Number.isFinite(x));
  if (series.length === 0) return { predicted: 0, trend: 0, confidence: 0 };
  if (series.length === 1) return { predicted: series[0], trend: 0, confidence: 0.2 };

  // EWMA over newest-first series.
  const a = SETTINGS.ewmaAlpha;
  let ewma = 0;
  let weight = 0;
  for (let i = 0; i < series.length; i++) {
    const w = a * (1 - a) ** i;
    ewma += w * series[i];
    weight += w;
  }
  ewma /= weight;

  // OLS slope over chronological order (oldest -> newest), USD per epoch.
  const chron = [...series].reverse();
  const n = chron.length;
  const xMean = (n - 1) / 2;
  const yMean = chron.reduce((s, y) => s + y, 0) / n;
  let num = 0;
  let den = 0;
  for (let x = 0; x < n; x++) {
    num += (x - xMean) * (chron[x] - yMean);
    den += (x - xMean) ** 2;
  }
  const slope = den > 0 ? num / den : 0;

  // Blend: level + half the momentum, never below zero. Damping the trend
  // avoids over-extrapolating one hot week.
  const predicted = Math.max(0, ewma + 0.5 * slope);

  // Confidence: more history and lower relative variance = higher confidence.
  const variance = chron.reduce((s, y) => s + (y - yMean) ** 2, 0) / n;
  const cv = yMean > 0 ? Math.sqrt(variance) / yMean : 1;
  const depthScore = Math.min(1, (n - 1) / 5);
  const stabilityScore = 1 / (1 + cv);
  const confidence = Math.round(depthScore * stabilityScore * 100) / 100;

  return { predicted, trend: slope, confidence };
}

export interface MarketSnapshot {
  generatedAt: number;
  forecasts: PoolForecast[];
}

let snapshotCache: { at: number; promise: Promise<MarketSnapshot> } | null = null;

/** Build (and cache) the full market snapshot: pools, histories, forecasts. */
export function getMarketSnapshot(force = false): Promise<MarketSnapshot> {
  const now = Date.now();
  if (!force && snapshotCache && now - snapshotCache.at < SETTINGS.cacheTtlMs) {
    return snapshotCache.promise;
  }
  const promise = buildSnapshot();
  snapshotCache = { at: now, promise };
  promise.catch(() => {
    snapshotCache = null;
  });
  return promise;
}

async function buildSnapshot(): Promise<MarketSnapshot> {
  const pools = await scanPools({ maxPools: SETTINGS.maxCandidates });
  const histories = await fetchHistories(pools.map((p) => p.lp));

  const partials = pools.map((pool) => {
    const history = histories.get(pool.lp.toLowerCase()) ?? [];
    const { current, completed } = splitCurrentEpoch(history);
    const feeSeries = completed.map((e) => e.feesUsd);

    // The in-progress epoch is the freshest demand signal, but dividing by
    // progress explodes early-epoch noise (a $2k burst on Thursday reads as a
    // $70k week). Estimate the full epoch as realized fees so far plus the
    // last completed epoch's pace for the remainder — low variance early,
    // converging to the realized total as the epoch matures.
    const progress = epochProgress();
    if (current && progress > 0.05) {
      const pace = completed[0]?.feesUsd ?? current.feesUsd / progress;
      feeSeries.unshift(current.feesUsd + pace * (1 - progress));
    }

    const { predicted, trend, confidence } = forecastFees(feeSeries);
    return { pool, history, current, completed, predicted, trend, confidence };
  });

  const totalPredicted = partials.reduce((s, p) => s + p.predicted, 0);
  const totalVotes = partials.reduce((s, p) => s + (p.current?.votes ?? p.completed[0]?.votes ?? 0), 0);

  const forecasts: PoolForecast[] = partials.map((p) => {
    const votes = p.current?.votes ?? p.completed[0]?.votes ?? 0;
    const voteShare = totalVotes > 0 ? votes / totalVotes : 0;
    const predictedDemandShare = totalPredicted > 0 ? p.predicted / totalPredicted : 0;
    const last = p.completed[0];
    const lastRewards = (last?.feesUsd ?? 0) + (last?.bribesUsd ?? 0);
    const lastVotes = last?.votes ?? 0;
    return {
      pool: p.pool,
      history: p.history,
      currentVotes: Math.round(votes),
      predictedFeesUsd: round2(p.predicted),
      lastEpochFeesUsd: round2(last?.feesUsd ?? 0),
      feeTrendUsdPerEpoch: round2(p.trend),
      currentBribesUsd: round2(p.current?.bribesUsd ?? 0),
      voteShare,
      predictedDemandShare,
      predictiveEdge: predictedDemandShare - voteShare,
      rewardPer1kVotesUsd: lastVotes > 0 ? round2((lastRewards / lastVotes) * 1000) : 0,
      confidence: p.confidence,
    };
  });

  forecasts.sort((a, b) => b.predictedFeesUsd - a.predictedFeesUsd);
  return { generatedAt: Date.now(), forecasts };
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

/**
 * Optimal split of `votingPower` votes across pools where pool i pays
 * rewards R_i shared pro-rata: your payout is R_i * v_i / (E_i + v_i).
 * Total payout is maximized by equalizing marginal returns
 * R_i * E_i / (E_i + v_i)^2 = λ  →  v_i(λ) = max(0, sqrt(R_i * E_i / λ) - E_i),
 * with λ found by bisection so Σ v_i = votingPower. Dust pools naturally
 * receive only the few votes their reward capacity can pay for.
 */
function waterfillVotes(
  pools: Array<{ rewardsUsd: number; existingVotes: number }>,
  votingPower: number,
): number[] {
  const eps = pools.map((p) => ({ r: p.rewardsUsd, e: Math.max(p.existingVotes, 1) }));
  const allocAt = (lambda: number) => eps.map((p) => Math.max(0, Math.sqrt((p.r * p.e) / lambda) - p.e));

  // λ is the marginal USD-per-vote; bracket it between "everything allocated"
  // and "nothing allocated" (max marginal at v=0 is r/e).
  let hi = Math.max(...eps.map((p) => p.r / p.e), 1e-12);
  let lo = hi * 1e-12;
  for (let i = 0; i < 100; i++) {
    const mid = Math.sqrt(lo * hi);
    const total = allocAt(mid).reduce((s, x) => s + x, 0);
    if (total > votingPower) lo = mid;
    else hi = mid;
  }
  const v = allocAt(Math.sqrt(lo * hi));
  const total = v.reduce((s, x) => s + x, 0);
  return total > 0 ? v.map((x) => (x * votingPower) / total) : v;
}

/**
 * Water-fill with a per-pool concentration cap: the unconstrained optimum can
 * put most votes into one low-confidence pool riding a short fee burst, which
 * is a poor default for real voting. Saturated pools are pinned at the cap and
 * the remainder is re-filled across the rest.
 */
function waterfillCapped(
  pools: Array<{ rewardsUsd: number; existingVotes: number }>,
  votingPower: number,
  capFraction: number,
): number[] {
  const n = pools.length;
  const cap = Math.max(capFraction, 1 / n) * votingPower;
  const votes = new Array<number>(n).fill(0);
  let active = Array.from({ length: n }, (_, i) => i);
  let remaining = votingPower;

  for (let round = 0; round < n && remaining > 1e-6 && active.length > 0; round++) {
    const fill = waterfillVotes(active.map((i) => pools[i]), remaining);
    const saturated = active.filter((_, k) => fill[k] >= cap);
    if (saturated.length === 0) {
      active.forEach((i, k) => (votes[i] = fill[k]));
      return votes;
    }
    for (const i of saturated) {
      votes[i] = cap;
      remaining -= cap;
    }
    active = active.filter((i) => !saturated.includes(i));
  }

  if (remaining > 1e-6) {
    // Everything hit the cap; spread the remainder pro-rata so weights still sum.
    const total = votes.reduce((s, x) => s + x, 0) || 1;
    for (let i = 0; i < n; i++) votes[i] += (remaining * votes[i]) / total;
  }
  return votes;
}

/**
 * Turn forecasts into a concrete allocation.
 *
 * protocol_efficiency: weights proportional to predicted fee demand — what an
 * ideal Predictive Allocation outcome looks like. Useful for benchmarking and
 * for directing incentives as a protocol/treasury.
 *
 * voter_roi: maximize the voter's expected next-epoch reward for a given
 * amount of veAERO, accounting for self-dilution (adding votes to a pool
 * shrinks its per-vote payout). Pools below the reward-capacity floor are
 * excluded so thin dust pools can't top the ranking.
 */
interface VoterRoiCandidate {
  f: PoolForecast;
  /** Expected next-epoch pool payout (fees blended by confidence + current bribes), USD. */
  rewardsUsd: number;
}

/**
 * Eligible pools with their expected payout for the voter_roi objective:
 * predicted fees blended toward the last realized epoch by forecast
 * confidence (a shaky forecast shouldn't outrank a pool's demonstrated
 * payout), plus incentives already posted. Shared by recommendAllocation
 * and simulateBribeImpact so both reason about the same market.
 */
function voterRoiCandidates(snapshot: MarketSnapshot, minRewardsUsd = SETTINGS.minVoterRewardCapacityUsd): VoterRoiCandidate[] {
  return snapshot.forecasts
    .filter((f) => f.pool.gaugeAlive && f.confidence > 0)
    .map((f) => ({
      f,
      rewardsUsd: f.confidence * f.predictedFeesUsd + (1 - f.confidence) * f.lastEpochFeesUsd + f.currentBribesUsd,
    }))
    .filter((c) => c.rewardsUsd >= minRewardsUsd);
}

export function recommendAllocation(
  snapshot: MarketSnapshot,
  objective: AllocationObjective,
  maxPools = 10,
  votingPowerVe = 10_000,
  maxWeightFraction = 0.35,
): AllocationRecommendation {
  const eligible = snapshot.forecasts.filter((f) => f.pool.gaugeAlive && f.confidence > 0);

  let scored: Array<{ f: PoolForecast; weight: number; expectedRewardUsd?: number; rationale: string }>;

  if (objective === "protocol_efficiency") {
    scored = eligible
      .filter((f) => f.predictedDemandShare > 0)
      .sort((a, b) => b.predictedDemandShare - a.predictedDemandShare)
      .slice(0, maxPools)
      .map((f) => ({
        f,
        weight: f.predictedDemandShare,
        rationale: rationaleFor(f, "demand"),
      }));
  } else {
    const candidates = voterRoiCandidates(snapshot);

    const votes = waterfillCapped(
      candidates.map((c) => ({ rewardsUsd: c.rewardsUsd, existingVotes: c.f.currentVotes })),
      votingPowerVe,
      maxWeightFraction,
    );

    scored = candidates
      .map((c, i) => {
        const v = votes[i];
        const expected = (c.rewardsUsd * v) / (Math.max(c.f.currentVotes, 1) + v);
        return {
          f: c.f,
          weight: v / votingPowerVe,
          expectedRewardUsd: round2(expected),
          rationale:
            `~$${round2(expected)} expected for ${Math.round(v).toLocaleString()} votes ` +
            `(pool pays ~$${Math.round(c.rewardsUsd).toLocaleString()}, has ${c.f.currentVotes.toLocaleString()} votes); ` +
            rationaleFor(c.f, "roi"),
        };
      })
      .filter((x) => x.weight > 0.001)
      .sort((a, b) => b.weight - a.weight)
      .slice(0, maxPools);
  }

  const totalW = scored.reduce((s, x) => s + x.weight, 0);
  const allocations = scored.map(({ f, weight, expectedRewardUsd, rationale }) => ({
    pool: f.pool.lp,
    symbol: f.pool.symbol,
    weightPct: round2((weight / totalW) * 100),
    currentVoteSharePct: round2(f.voteShare * 100),
    predictedDemandSharePct: round2(f.predictedDemandShare * 100),
    predictiveEdgePct: round2(f.predictiveEdge * 100),
    rewardPer1kVotesUsd: f.rewardPer1kVotesUsd,
    ...(expectedRewardUsd !== undefined && { expectedRewardUsd }),
    confidence: f.confidence,
    rationale,
  }));

  const topEdge = [...eligible].sort((a, b) => b.predictiveEdge - a.predictiveEdge)[0];
  const totalExpected = round2(scored.reduce((s, x) => s + (x.expectedRewardUsd ?? 0), 0));
  const summary =
    objective === "protocol_efficiency"
      ? `Allocate proportional to predicted next-epoch fee demand across ${allocations.length} pools. ` +
        `Largest mispricing: ${topEdge?.pool.symbol ?? "n/a"} is under-incentivized by ` +
        `${round2((topEdge?.predictiveEdge ?? 0) * 100)}pp of vote share vs predicted demand.`
      : `Dilution-aware optimal split of ${votingPowerVe.toLocaleString()} veAERO across ${allocations.length} pools ` +
        `(${Math.round(maxWeightFraction * 100)}% per-pool cap): expected ~$${totalExpected} next epoch ` +
        `(~$${round2((totalExpected / votingPowerVe) * 1000)}/1k votes after dilution).`;

  return {
    objective,
    generatedAt: new Date(snapshot.generatedAt).toISOString(),
    epochStart: currentEpochStart(),
    epochProgressPct: round2(epochProgress() * 100),
    ...(objective === "voter_roi" && { votingPowerVe }),
    allocations,
    summary,
  };
}

export interface BribeImpactSimulation {
  pool: string;
  symbol: string;
  bribeBudgetUsd: number;
  baselineVotes: number;
  projectedVotes: number;
  voteGain: number;
  baselineVoteSharePct: number;
  projectedVoteSharePct: number;
  voteShareGainPct: number;
  /** Effective cost per 1,000 incremental votes attracted (matches rewardPer1kVotesUsd elsewhere); null if the bribe attracted ~0 votes. */
  usdPer1kIncrementalVotes: number | null;
  /** Pools that lose the most votes to this bribe, as the market rebalances. */
  diluted: Array<{ pool: string; symbol: string; voteLoss: number }>;
  assumptions: string;
}

/**
 * Estimate the vote-share a bribe would pull toward `targetPool`, for a team
 * or protocol deciding where to spend a bribe budget rather than a veAERO
 * holder deciding how to vote.
 *
 * Treats the market's total active voting power as fully reallocatable
 * (existingVotes=0 for every pool — see waterfillVotes) and re-optimizes it
 * from scratch by payout, both with and without the bribe added to the
 * target pool's rewardsUsd; the difference is the bribe's pull. Since
 * water-filling gives votes ∝ √rewardsUsd, the marginal $/vote is highest
 * on lower-payout pools — a bribe dollar goes further on a small pool than
 * a saturated one, which matches how real bribe markets behave. This is a
 * theoretical ceiling (instant, frictionless, whole-market reallocation),
 * not a forecast — treat it as a way to *compare* candidate pools, not to
 * predict a literal vote count. See `assumptions` on the result.
 */
export function simulateBribeImpact(
  snapshot: MarketSnapshot,
  targetPool: string,
  bribeBudgetUsd: number,
  maxWeightFraction = 0.35,
): BribeImpactSimulation {
  // No reward-capacity floor here (unlike recommendAllocation): the whole
  // point is to see pools the bribe itself could bring into contention.
  const candidates = voterRoiCandidates(snapshot, 0);
  const totalVotingPower = candidates.reduce((s, c) => s + c.f.currentVotes, 0);
  if (totalVotingPower <= 0) {
    throw new Error("No eligible voting power in the current snapshot to simulate against.");
  }

  const targetIdx = candidates.findIndex((c) => c.f.pool.lp.toLowerCase() === targetPool.toLowerCase());
  if (targetIdx === -1) {
    throw new Error(`Pool ${targetPool} is not an eligible gauge-alive pool in the current snapshot.`);
  }

  const baseline = waterfillCapped(
    candidates.map((c) => ({ rewardsUsd: c.rewardsUsd, existingVotes: 0 })),
    totalVotingPower,
    maxWeightFraction,
  );
  const bumped = waterfillCapped(
    candidates.map((c, i) => ({
      rewardsUsd: i === targetIdx ? c.rewardsUsd + bribeBudgetUsd : c.rewardsUsd,
      existingVotes: 0,
    })),
    totalVotingPower,
    maxWeightFraction,
  );

  const voteGain = bumped[targetIdx] - baseline[targetIdx];
  const diluted = candidates
    .map((c, i) => ({ pool: c.f.pool.lp, symbol: c.f.pool.symbol, voteLoss: baseline[i] - bumped[i] }))
    .filter((d, i) => i !== targetIdx && d.voteLoss > 0.5)
    .sort((a, b) => b.voteLoss - a.voteLoss)
    .slice(0, 3);

  const target = candidates[targetIdx].f;
  return {
    pool: target.pool.lp,
    symbol: target.pool.symbol,
    bribeBudgetUsd: round2(bribeBudgetUsd),
    baselineVotes: Math.round(baseline[targetIdx]),
    projectedVotes: Math.round(bumped[targetIdx]),
    voteGain: Math.round(voteGain),
    baselineVoteSharePct: round2((baseline[targetIdx] / totalVotingPower) * 100),
    projectedVoteSharePct: round2((bumped[targetIdx] / totalVotingPower) * 100),
    voteShareGainPct: round2((voteGain / totalVotingPower) * 100),
    usdPer1kIncrementalVotes: voteGain > 0.5 ? round2((bribeBudgetUsd / voteGain) * 1000) : null,
    diluted,
    assumptions:
      `Models a full, instant, frictionless re-optimization of the market's ${Math.round(totalVotingPower).toLocaleString()} ` +
      "active votes by payout alone (votes ∝ √rewardsUsd), ignoring who currently holds them or how fast real " +
      "voters actually move. That makes this a theoretical ceiling, not a forecast — real single-epoch vote " +
      "shifts from one bribe will be much smaller. Use it to compare candidate pools (which is cheapest to move " +
      "per dollar), not to predict an absolute vote count.",
  };
}

function rationaleFor(f: PoolForecast, kind: "demand" | "roi"): string {
  const trend =
    f.feeTrendUsdPerEpoch > 0
      ? `fees growing ~$${Math.abs(f.feeTrendUsdPerEpoch).toLocaleString()}/epoch`
      : f.feeTrendUsdPerEpoch < 0
        ? `fees declining ~$${Math.abs(f.feeTrendUsdPerEpoch).toLocaleString()}/epoch`
        : "fees flat";
  if (kind === "demand") {
    return `Predicted $${f.predictedFeesUsd.toLocaleString()} next-epoch fees (${trend}); ` +
      `vote share ${round2(f.voteShare * 100)}% vs demand share ${round2(f.predictedDemandShare * 100)}%.`;
  }
  return `~$${f.rewardPer1kVotesUsd}/1k votes last epoch; ${trend}; ` +
    `edge ${round2(f.predictiveEdge * 100)}pp; confidence ${f.confidence}.`;
}

/** Compact epoch history view for tool output. */
export function summarizeHistory(history: EpochStats[]): Array<Record<string, number | string>> {
  return history.map((e) => ({
    epoch: new Date(e.ts * 1000).toISOString().slice(0, 10),
    votes: Math.round(e.votes),
    emissions: Math.round(e.emissions),
    feesUsd: Math.round(e.feesUsd),
    bribesUsd: Math.round(e.bribesUsd),
  }));
}
