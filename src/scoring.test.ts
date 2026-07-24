import { describe, expect, it } from "vitest";
import { forecastFees, recommendAllocation, summarizeHistory, type MarketSnapshot } from "./scoring.js";
import type { PoolForecast, PoolInfo } from "./types.js";

describe("forecastFees", () => {
  it("returns all zeros for an empty series", () => {
    expect(forecastFees([])).toEqual({ predicted: 0, trend: 0, confidence: 0 });
  });

  it("returns the lone value with low confidence for a single-epoch series", () => {
    expect(forecastFees([100])).toEqual({ predicted: 100, trend: 0, confidence: 0.2 });
  });

  it("filters out non-finite entries before forecasting", () => {
    const withJunk = forecastFees([100, NaN, Infinity, -Infinity]);
    const clean = forecastFees([100]);
    expect(withJunk).toEqual(clean);
  });

  it("detects a positive trend in a steadily growing series (newest first)", () => {
    const { predicted, trend } = forecastFees([400, 300, 200, 100]);
    expect(trend).toBeGreaterThan(0);
    // Damped trend blend lands above the plain mean but needn't clear the
    // single latest point — EWMA still discounts it against older history.
    expect(predicted).toBeGreaterThan(250);
  });

  it("detects a negative trend in a steadily declining series (newest first)", () => {
    const { predicted, trend } = forecastFees([100, 200, 300, 400]);
    expect(trend).toBeLessThan(0);
    expect(predicted).toBeLessThan(400);
  });

  it("never predicts a negative value even under a steep decline", () => {
    const { predicted } = forecastFees([1, 2, 1000]);
    expect(predicted).toBeGreaterThanOrEqual(0);
  });

  it("gives higher confidence to a longer, stabler history", () => {
    const long = forecastFees([100, 102, 98, 101, 99, 100]);
    const short = forecastFees([100, 300]);
    expect(long.confidence).toBeGreaterThan(short.confidence);
  });

  it("keeps confidence within [0, 1]", () => {
    for (const series of [[100, 102, 98, 101, 99, 100], [1, 1000], [0, 0, 0]]) {
      const { confidence } = forecastFees(series);
      expect(confidence).toBeGreaterThanOrEqual(0);
      expect(confidence).toBeLessThanOrEqual(1);
    }
  });
});

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

function makeForecast(overrides: Omit<Partial<PoolForecast>, "pool"> & { pool?: Partial<PoolInfo> } = {}): PoolForecast {
  const { pool: poolOverrides, ...rest } = overrides;
  return {
    pool: makePool(poolOverrides),
    history: [],
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
    ...rest,
  };
}

function snapshotOf(forecasts: PoolForecast[]): MarketSnapshot {
  return { generatedAt: Date.now(), forecasts };
}

describe("recommendAllocation — protocol_efficiency", () => {
  it("weights proportional to predicted demand share and sums to 100%", () => {
    const snapshot = snapshotOf([
      makeForecast({ predictedDemandShare: 0.5 }),
      makeForecast({ predictedDemandShare: 0.3 }),
      makeForecast({ predictedDemandShare: 0.2 }),
    ]);
    const rec = recommendAllocation(snapshot, "protocol_efficiency");
    const total = rec.allocations.reduce((s, a) => s + a.weightPct, 0);
    expect(total).toBeCloseTo(100, 0);
    expect(rec.allocations[0].weightPct).toBeGreaterThan(rec.allocations[1].weightPct);
    expect(rec.allocations[1].weightPct).toBeGreaterThan(rec.allocations[2].weightPct);
  });

  it("excludes pools with a dead gauge", () => {
    const snapshot = snapshotOf([
      makeForecast({ predictedDemandShare: 0.6 }),
      makeForecast({ predictedDemandShare: 0.4, pool: { gaugeAlive: false } }),
    ]);
    const rec = recommendAllocation(snapshot, "protocol_efficiency");
    expect(rec.allocations).toHaveLength(1);
  });

  it("excludes pools with zero forecast confidence", () => {
    const snapshot = snapshotOf([
      makeForecast({ predictedDemandShare: 0.6 }),
      makeForecast({ predictedDemandShare: 0.4, confidence: 0 }),
    ]);
    const rec = recommendAllocation(snapshot, "protocol_efficiency");
    expect(rec.allocations).toHaveLength(1);
  });

  it("excludes pools with no predicted demand share", () => {
    const snapshot = snapshotOf([
      makeForecast({ predictedDemandShare: 0.6 }),
      makeForecast({ predictedDemandShare: 0 }),
    ]);
    const rec = recommendAllocation(snapshot, "protocol_efficiency");
    expect(rec.allocations).toHaveLength(1);
  });
});

describe("recommendAllocation — voter_roi", () => {
  it("excludes pools below the minimum reward-capacity floor", () => {
    const snapshot = snapshotOf([
      makeForecast({ predictedFeesUsd: 100_000, lastEpochFeesUsd: 100_000 }),
      makeForecast({ predictedFeesUsd: 10, lastEpochFeesUsd: 10 }), // well under the $500 floor
    ]);
    const rec = recommendAllocation(snapshot, "voter_roi", 8, 10_000);
    expect(rec.allocations).toHaveLength(1);
  });

  it("favors the less-diluted pool when expected rewards are otherwise equal", () => {
    const snapshot = snapshotOf([
      makeForecast({ predictedFeesUsd: 100_000, lastEpochFeesUsd: 100_000, currentVotes: 1_000 }),
      makeForecast({ predictedFeesUsd: 100_000, lastEpochFeesUsd: 100_000, currentVotes: 5_000 }),
    ]);
    // maxWeightFraction=1 (uncapped): with only 2 pools the per-pool cap's
    // 1/n floor would otherwise force an even 50/50 split regardless of dilution.
    // votingPower large enough relative to existing votes that both pools clear
    // the marginal-return threshold and receive a nonzero allocation.
    const rec = recommendAllocation(snapshot, "voter_roi", 8, 1_000_000, 1);
    expect(rec.allocations).toHaveLength(2);
    const [lessDiluted, moreDiluted] = rec.allocations;
    expect(lessDiluted.weightPct).toBeGreaterThan(moreDiluted.weightPct);
  });

  it("never allocates more than the per-pool cap fraction", () => {
    const snapshot = snapshotOf([
      makeForecast({ predictedFeesUsd: 10_000_000, lastEpochFeesUsd: 10_000_000, currentVotes: 1 }),
      ...Array.from({ length: 4 }, () =>
        makeForecast({ predictedFeesUsd: 5_000, lastEpochFeesUsd: 5_000, currentVotes: 100_000 }),
      ),
    ]);
    const rec = recommendAllocation(snapshot, "voter_roi", 8, 10_000, 0.35);
    for (const a of rec.allocations) {
      expect(a.weightPct).toBeLessThanOrEqual(35.5);
    }
  });

  it("caps the number of allocations at maxPools", () => {
    const snapshot = snapshotOf(
      Array.from({ length: 10 }, (_, i) =>
        makeForecast({ predictedFeesUsd: 10_000 + i, lastEpochFeesUsd: 10_000 + i, currentVotes: 1_000 }),
      ),
    );
    const rec = recommendAllocation(snapshot, "voter_roi", 3, 10_000);
    expect(rec.allocations).toHaveLength(3);
  });
});

describe("summarizeHistory", () => {
  it("rounds and formats epoch stats for display", () => {
    const out = summarizeHistory([{ ts: 1_700_000_000, votes: 100.6, emissions: 50.4, feesUsd: 10.5, bribesUsd: 2.2 }]);
    expect(out).toEqual([
      { epoch: "2023-11-14", votes: 101, emissions: 50, feesUsd: 11, bribesUsd: 2 },
    ]);
  });

  it("returns an empty array for empty history", () => {
    expect(summarizeHistory([])).toEqual([]);
  });
});
