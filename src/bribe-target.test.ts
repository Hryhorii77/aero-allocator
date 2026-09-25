import { describe, expect, it } from "vitest";
import { minimumBribeForTarget } from "./bribe-target.js";
import { simulateBribeImpact, type MarketSnapshot } from "./scoring.js";
import type { PoolForecast, PoolInfo } from "./types.js";

function forecast(n: number, opts: { fees: number; votes: number; bribes?: number }): PoolForecast {
  const pool: PoolInfo = {
    lp: `0x${n.toString().padStart(40, "0")}`,
    symbol: `POOL${n}`,
    poolType: "v2-volatile",
    tickSpacing: null,
    token0: "0xt0",
    token1: "0xt1",
    gauge: "0xgauge",
    gaugeAlive: true,
    reserve0: 0,
    reserve1: 0,
    staked0: 0,
    staked1: 0,
    tvlUsd: 1_000_000,
    stakedTvlUsd: 1_000_000,
    poolFeeBps: 30,
    emissionsPerSec: 0,
  };
  return {
    pool,
    history: [],
    predictedFeesUsd: opts.fees,
    lastEpochFeesUsd: opts.fees,
    feeTrendUsdPerEpoch: 0,
    currentBribesUsd: opts.bribes ?? 0,
    currentVotes: opts.votes,
    voteShare: 0,
    predictedDemandShare: 0,
    predictiveEdge: 0,
    rewardPer1kVotesUsd: 0,
    confidence: 0.8,
  };
}

// A big pool, a mid pool, and three small ones — the small one (POOL5) is the bribe target.
const snap: MarketSnapshot = {
  generatedAt: 1,
  forecasts: [
    forecast(1, { fees: 90_000, votes: 4_000_000 }),
    forecast(2, { fees: 40_000, votes: 2_000_000 }),
    forecast(3, { fees: 20_000, votes: 1_000_000 }),
    forecast(4, { fees: 8_000, votes: 400_000 }),
    forecast(5, { fees: 3_000, votes: 200_000, bribes: 750 }),
  ],
};
const target = snap.forecasts[4].pool.lp;

describe("minimumBribeForTarget", () => {
  it("returns a budget that reaches the target, and one that a bit less does not", () => {
    const base = simulateBribeImpact(snap, target, 0).baselineVoteSharePct;
    const goal = base + 3;
    const r = minimumBribeForTarget(snap, target, goal);
    expect(r.feasible).toBe(true);
    expect(r.minBribeUsd).toBeGreaterThan(0);
    expect(simulateBribeImpact(snap, target, r.minBribeUsd!).projectedVoteSharePct).toBeGreaterThanOrEqual(goal);
    // Minimal: the bisection isn't just returning a generous upper bound.
    expect(simulateBribeImpact(snap, target, r.minBribeUsd! * 0.9).projectedVoteSharePct).toBeLessThan(goal);
    expect(r.projectedVoteSharePct).toBeGreaterThanOrEqual(goal);
    expect(r.votesNeeded).toBeGreaterThan(0);
  });

  it("costs more for a bigger target, and prices each step along the way", () => {
    const base = simulateBribeImpact(snap, target, 0).baselineVoteSharePct;
    const small = minimumBribeForTarget(snap, target, base + 1);
    const large = minimumBribeForTarget(snap, target, base + 4);
    expect(large.minBribeUsd!).toBeGreaterThan(small.minBribeUsd!);

    const curve = large.costCurve;
    expect(curve).toHaveLength(4);
    expect(curve.map((c) => c.minBribeUsd)).toEqual([...curve.map((c) => c.minBribeUsd)].sort((a, b) => a - b));
    expect(curve[3].minBribeUsd).toBe(large.minBribeUsd);
    expect(curve[3].targetVoteSharePct).toBeCloseTo(base + 4, 1);
  });

  it("asks for nothing when the pool already has that share", () => {
    const base = simulateBribeImpact(snap, target, 0).baselineVoteSharePct;
    const r = minimumBribeForTarget(snap, target, base);
    expect(r).toMatchObject({ feasible: true, minBribeUsd: 0, votesNeeded: 0 });
    expect(r.reason).toMatch(/already/i);
  });

  it("says a target is unreachable rather than inventing a price, when it's past the concentration cap", () => {
    const r = minimumBribeForTarget(snap, target, 50); // cap is 35%
    expect(r.feasible).toBe(false);
    expect(r.minBribeUsd).toBeNull();
    expect(r.reason).toMatch(/35%/);
    // ...and a looser cap makes the same target reachable.
    expect(minimumBribeForTarget(snap, target, 50, 0.9).feasible).toBe(true);
  });

  it("echoes the bribes already posted, and labels the answer a floor", () => {
    const r = minimumBribeForTarget(snap, target, 6);
    expect(r.postedBribesUsd).toBe(750);
    expect(r.basis).toMatch(/floor, not a quote/i);
  });

  it("rejects a target that isn't a share, and a pool that isn't in the market", () => {
    expect(() => minimumBribeForTarget(snap, target, 0)).toThrow(/above 0/);
    expect(() => minimumBribeForTarget(snap, target, 101)).toThrow(/at most 100/);
    expect(() => minimumBribeForTarget(snap, target, Number.NaN)).toThrow();
    expect(() => minimumBribeForTarget(snap, "0xnotapool", 5)).toThrow(/not an eligible/i);
  });
});
