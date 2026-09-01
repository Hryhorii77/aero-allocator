import { describe, expect, it } from "vitest";
import { computeRealizedPerformance, type LoggedRecommendation } from "./tracking.js";
import type { MarketSnapshot } from "./scoring.js";
import { currentEpochStart, WEEK } from "./config.js";
import type { EpochStats, PoolForecast, PoolInfo } from "./types.js";

let lpCounter = 0;

function makePool(overrides: Partial<PoolInfo> = {}): PoolInfo {
  lpCounter += 1;
  return {
    lp: `0x${lpCounter.toString().padStart(40, "0")}`,
    symbol: `POOL${lpCounter}`,
    poolType: "v2-volatile",
    tickSpacing: null,
    token0: "0xtoken0",
    token1: "0xtoken1",
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
    ...overrides,
  };
}

function makeForecast(pool: PoolInfo, history: EpochStats[]): PoolForecast {
  return {
    pool,
    history,
    predictedFeesUsd: 0,
    lastEpochFeesUsd: 0,
    feeTrendUsdPerEpoch: 0,
    currentBribesUsd: 0,
    currentVotes: 1000,
    voteShare: 0,
    predictedDemandShare: 0,
    predictiveEdge: 0,
    rewardPer1kVotesUsd: 0,
    confidence: 1,
  };
}

function snapshotOf(forecasts: PoolForecast[]): MarketSnapshot {
  return { generatedAt: Date.now(), forecasts };
}

const completedEpochStart = currentEpochStart() - WEEK; // definitely finished
const inProgressEpochStart = currentEpochStart(); // still running

describe("computeRealizedPerformance", () => {
  it("skips epochs that haven't completed yet", () => {
    const pool = makePool();
    const log: LoggedRecommendation[] = [
      {
        epochStart: inProgressEpochStart,
        generatedAt: new Date().toISOString(),
        protocol: "aerodrome",
        votingPowerVe: 10_000,
        allocations: [{ pool: pool.lp, symbol: pool.symbol, weightPct: 100, votesAllocated: 10_000, expectedRewardUsd: 50 }],
        totalExpectedRewardUsd: 50,
      },
    ];
    const snap = snapshotOf([makeForecast(pool, [])]);
    expect(computeRealizedPerformance(log, snap)).toEqual([]);
  });

  it("computes realized reward with the same R·v/(E+v) formula the prediction used", () => {
    const pool = makePool();
    const votesAllocated = 10_000;
    const actualFeesUsd = 8_000;
    const actualBribesUsd = 2_000;
    const actualVotesAtLock = 90_000;

    const log: LoggedRecommendation[] = [
      {
        epochStart: completedEpochStart,
        generatedAt: new Date().toISOString(),
        protocol: "aerodrome",
        votingPowerVe: votesAllocated,
        allocations: [{ pool: pool.lp, symbol: pool.symbol, weightPct: 100, votesAllocated, expectedRewardUsd: 500 }],
        totalExpectedRewardUsd: 500,
      },
    ];
    const snap = snapshotOf([
      makeForecast(pool, [
        { ts: completedEpochStart, votes: actualVotesAtLock, emissions: 0, feesUsd: actualFeesUsd, bribesUsd: actualBribesUsd },
      ]),
    ]);

    const [result] = computeRealizedPerformance(log, snap);
    const expectedRealized = ((actualFeesUsd + actualBribesUsd) * votesAllocated) / (actualVotesAtLock + votesAllocated);

    expect(result.pools[0].realizedRewardUsd).toBeCloseTo(expectedRealized, 2);
    expect(result.totalRealizedRewardUsd).toBeCloseTo(expectedRealized, 2);
    expect(result.totalExpectedRewardUsd).toBe(500);
  });

  it("reports skillPct positive when realized beats predicted, negative when it falls short", () => {
    const pool = makePool();
    const makeLog = (expectedRewardUsd: number): LoggedRecommendation[] => [
      {
        epochStart: completedEpochStart,
        generatedAt: new Date().toISOString(),
        protocol: "aerodrome",
        votingPowerVe: 10_000,
        allocations: [{ pool: pool.lp, symbol: pool.symbol, weightPct: 100, votesAllocated: 10_000, expectedRewardUsd }],
        totalExpectedRewardUsd: expectedRewardUsd,
      },
    ];
    const history: EpochStats[] = [{ ts: completedEpochStart, votes: 90_000, emissions: 0, feesUsd: 8_000, bribesUsd: 2_000 }];
    const snap = snapshotOf([makeForecast(pool, history)]);

    const beat = computeRealizedPerformance(makeLog(50), snap)[0]; // predicted low, actual is higher
    expect(beat.skillPct).toBeGreaterThan(0);

    const missed = computeRealizedPerformance(makeLog(5000), snap)[0]; // predicted high, actual is lower
    expect(missed.skillPct).toBeLessThan(0);
  });

  it("marks a pool's realized reward null when its epoch has rolled off the history window", () => {
    const pool = makePool();
    const log: LoggedRecommendation[] = [
      {
        epochStart: completedEpochStart,
        generatedAt: new Date().toISOString(),
        protocol: "aerodrome",
        votingPowerVe: 10_000,
        allocations: [{ pool: pool.lp, symbol: pool.symbol, weightPct: 100, votesAllocated: 10_000, expectedRewardUsd: 50 }],
        totalExpectedRewardUsd: 50,
      },
    ];
    // History present but doesn't include the logged epoch at all.
    const snap = snapshotOf([makeForecast(pool, [{ ts: completedEpochStart - WEEK, votes: 1, emissions: 0, feesUsd: 1, bribesUsd: 0 }])]);

    expect(computeRealizedPerformance(log, snap)).toEqual([]);
  });

  it("sorts results newest epoch first", () => {
    const pool = makePool();
    const olderEpoch = completedEpochStart - WEEK;
    const entryFor = (epochStart: number): LoggedRecommendation => ({
      epochStart,
      generatedAt: new Date().toISOString(),
      protocol: "aerodrome",
      votingPowerVe: 10_000,
      allocations: [{ pool: pool.lp, symbol: pool.symbol, weightPct: 100, votesAllocated: 10_000, expectedRewardUsd: 50 }],
      totalExpectedRewardUsd: 50,
    });
    const history: EpochStats[] = [
      { ts: completedEpochStart, votes: 90_000, emissions: 0, feesUsd: 8_000, bribesUsd: 2_000 },
      { ts: olderEpoch, votes: 90_000, emissions: 0, feesUsd: 8_000, bribesUsd: 2_000 },
    ];
    const snap = snapshotOf([makeForecast(pool, history)]);

    const results = computeRealizedPerformance([entryFor(olderEpoch), entryFor(completedEpochStart)], snap);
    expect(results.map((r) => r.epochStart)).toEqual([completedEpochStart, olderEpoch]);
  });
});
