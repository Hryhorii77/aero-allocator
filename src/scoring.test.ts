import { describe, expect, it } from "vitest";
import {
  applyConfidenceCalibration,
  detectVoteSwings,
  forecastFees,
  recommendAllocation,
  recommendLpDeposits,
  simulateBribeImpact,
  summarizeHistory,
  type ConfidenceCalibrationBucket,
  type MarketSnapshot,
} from "./scoring.js";
import { WEEK, currentEpochStart, epochProgress } from "./config.js";
import type { EpochStats, PoolForecast, PoolInfo } from "./types.js";

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

describe("simulateBribeImpact", () => {
  it("throws for a pool not in the snapshot", () => {
    const snapshot = snapshotOf([makeForecast({ predictedFeesUsd: 10_000, currentVotes: 1_000 })]);
    expect(() => simulateBribeImpact(snapshot, "0x" + "9".repeat(40), 1_000)).toThrow(/not an eligible/);
  });

  it("throws when there is no eligible voting power to simulate against", () => {
    const snapshot = snapshotOf([makeForecast({ predictedFeesUsd: 10_000, currentVotes: 0 })]);
    const pool = snapshot.forecasts[0].pool.lp;
    expect(() => simulateBribeImpact(snapshot, pool, 1_000)).toThrow(/No eligible voting power/);
  });

  it("reports zero gain and a null $/vote for a zero bribe", () => {
    const snapshot = snapshotOf([
      makeForecast({ predictedFeesUsd: 10_000, currentVotes: 1_000 }),
      makeForecast({ predictedFeesUsd: 10_000, currentVotes: 1_000 }),
    ]);
    const pool = snapshot.forecasts[0].pool.lp;
    const sim = simulateBribeImpact(snapshot, pool, 0);
    expect(sim.voteGain).toBe(0);
    expect(sim.usdPer1kIncrementalVotes).toBeNull();
  });

  it("pulls votes toward the bribed pool and dilutes the rest, conserving total votes", () => {
    const snapshot = snapshotOf([
      makeForecast({ predictedFeesUsd: 1_000, currentVotes: 10_000 }), // target: cheap, under-voted
      makeForecast({ predictedFeesUsd: 50_000, currentVotes: 10_000 }),
      makeForecast({ predictedFeesUsd: 50_000, currentVotes: 10_000 }),
    ]);
    const pool = snapshot.forecasts[0].pool.lp;
    // Uncapped, so the whole market can rebalance without hitting the per-pool floor.
    const sim = simulateBribeImpact(snapshot, pool, 20_000, 1);

    expect(sim.voteGain).toBeGreaterThan(0);
    expect(sim.projectedVotes).toBeGreaterThan(sim.baselineVotes);
    expect(sim.usdPer1kIncrementalVotes).toBeGreaterThan(0);
    expect(sim.diluted.length).toBeGreaterThan(0);
    expect(sim.diluted.every((d) => d.voteLoss > 0)).toBe(true);

    // Votes are reallocated, not created: what the target gains, the rest lose (within the top-3 cutoff here since there are only 2 other pools).
    const totalDiluted = sim.diluted.reduce((s, d) => s + d.voteLoss, 0);
    expect(totalDiluted).toBeCloseTo(sim.voteGain, -1);
  });

  it("gives a bigger vote pull to a cheaper (lower-payout) pool than an expensive one, for the same budget", () => {
    // Votes water-fill ∝ √rewardsUsd, so the same $ bribe moves a low-payout
    // pool's √R much more (in relative and absolute terms) than a
    // high-payout one — a bribe dollar goes further on a small pool.
    const base = () =>
      snapshotOf([
        makeForecast({ predictedFeesUsd: 2_000, currentVotes: 1_000 }), // cheap
        makeForecast({ predictedFeesUsd: 200_000, currentVotes: 1_000 }), // expensive
        makeForecast({ predictedFeesUsd: 50_000, currentVotes: 1_000 }), // filler
      ]);

    const cheapSnap = base();
    const gainCheap = simulateBribeImpact(cheapSnap, cheapSnap.forecasts[0].pool.lp, 5_000, 1).voteGain;

    const expensiveSnap = base();
    const gainExpensive = simulateBribeImpact(expensiveSnap, expensiveSnap.forecasts[1].pool.lp, 5_000, 1).voteGain;

    expect(gainCheap).toBeGreaterThan(gainExpensive);
  });
});

describe("applyConfidenceCalibration", () => {
  const calibration: ConfidenceCalibrationBucket[] = [
    { min: 0, max: 0.5, n: 20, wape: 1, calibratedConfidence: 0.5 }, // noisy in practice, marked down
    { min: 0.5, max: 1, n: 20, wape: 0, calibratedConfidence: 1 }, // dead accurate, marked up
  ];

  it("remaps each forecast's confidence to its bucket's calibrated value", () => {
    const snapshot = snapshotOf([makeForecast({ confidence: 0.9 }), makeForecast({ confidence: 0.2 })]);
    const out = applyConfidenceCalibration(snapshot, calibration);
    expect(out.forecasts[0].confidence).toBe(1);
    expect(out.forecasts[1].confidence).toBe(0.5);
  });

  it("leaves other fields and the snapshot timestamp untouched", () => {
    const snapshot = snapshotOf([makeForecast({ confidence: 0.9, predictedFeesUsd: 12_345 })]);
    const out = applyConfidenceCalibration(snapshot, calibration);
    expect(out.generatedAt).toBe(snapshot.generatedAt);
    expect(out.forecasts[0].predictedFeesUsd).toBe(12_345);
  });

  it("leaves confidence unchanged when no bucket covers it", () => {
    const sparse: ConfidenceCalibrationBucket[] = [{ min: 0.8, max: 1, n: 20, wape: 0.1, calibratedConfidence: 0.9 }];
    const snapshot = snapshotOf([makeForecast({ confidence: 0.3 })]);
    const out = applyConfidenceCalibration(snapshot, sparse);
    expect(out.forecasts[0].confidence).toBe(0.3);
  });

  it("is a no-op for an empty calibration curve", () => {
    const snapshot = snapshotOf([makeForecast({ confidence: 0.42 })]);
    expect(applyConfidenceCalibration(snapshot, [])).toBe(snapshot);
  });
});

describe("recommendLpDeposits", () => {
  // `emissions` here is the per-second rate (matches EpochStats' real semantics), not a per-epoch total.
  function completedEpoch(epochsAgo: number, emissionsPerSec: number): EpochStats {
    return { ts: currentEpochStart() - epochsAgo * WEEK, votes: 0, emissions: emissionsPerSec, feesUsd: 0, bribesUsd: 0 };
  }

  it("throws for a non-positive AERO price", () => {
    const snapshot = snapshotOf([makeForecast()]);
    expect(() => recommendLpDeposits(snapshot, 0)).toThrow(/positive AERO\/USD/);
    expect(() => recommendLpDeposits(snapshot, -1)).toThrow(/positive AERO\/USD/);
  });

  it("excludes pools with a dead gauge or below the staked-TVL floor", () => {
    const snapshot = snapshotOf([
      makeForecast({ pool: { stakedTvlUsd: 100_000 } }),
      makeForecast({ pool: { stakedTvlUsd: 100_000, gaugeAlive: false } }),
      makeForecast({ pool: { stakedTvlUsd: 100 } }), // below default 1000 floor
    ]);
    const report = recommendLpDeposits(snapshot, 1, { minStakedTvlUsd: 1000 });
    expect(report.opportunities).toHaveLength(1);
  });

  it("computes currentEpochAprPct deterministically from the live emission rate, independent of history", () => {
    const weekPerYear = (365 * 24 * 60 * 60) / WEEK;
    const emissionsPerSec = 10; // raw units include the 18-decimal scale
    const snapshot = snapshotOf([
      makeForecast({ pool: { stakedTvlUsd: 1_000_000, emissionsPerSec: emissionsPerSec * 1e18 } }),
    ]);
    const report = recommendLpDeposits(snapshot, 2 /* aeroPriceUsd */, { minStakedTvlUsd: 0 });
    const expectedEmissionsUsd = emissionsPerSec * WEEK * 2;
    const expectedAprPct = (expectedEmissionsUsd / 1_000_000) * weekPerYear * 100;
    expect(report.opportunities[0].currentEpochAprPct).toBeCloseTo(expectedAprPct, 4);
  });

  it("forecasts predictedNextEpochAprPct from completed-epoch emissions history, scaled by epoch length", () => {
    const ratePerSec = 0.1;
    const snapshot = snapshotOf([
      makeForecast({
        pool: { stakedTvlUsd: 1_000_000, emissionsPerSec: 0 },
        history: [completedEpoch(1, ratePerSec), completedEpoch(2, ratePerSec), completedEpoch(3, ratePerSec)],
      }),
    ]);
    const report = recommendLpDeposits(snapshot, 1, { minStakedTvlUsd: 0 });
    // Flat rate history -> forecast ~ratePerSec next epoch -> total AERO = ratePerSec * WEEK.
    expect(report.opportunities[0].predictedNextEpochEmissionsUsd).toBeCloseTo(ratePerSec * WEEK, 0);
    expect(report.opportunities[0].predictedNextEpochAprPct).toBeGreaterThan(0);
  });

  it("sorts opportunities by predictedNextEpochAprPct descending", () => {
    const snapshot = snapshotOf([
      makeForecast({
        pool: { stakedTvlUsd: 1_000_000 },
        history: [completedEpoch(1, 10), completedEpoch(2, 10)],
      }),
      makeForecast({
        pool: { stakedTvlUsd: 1_000_000 },
        history: [completedEpoch(1, 1000), completedEpoch(2, 1000)],
      }),
    ]);
    const report = recommendLpDeposits(snapshot, 1, { minStakedTvlUsd: 0 });
    expect(report.opportunities[0].predictedNextEpochAprPct).toBeGreaterThan(
      report.opportunities[1].predictedNextEpochAprPct,
    );
  });

  it("notes that fees accrue to voters, not stakers", () => {
    const snapshot = snapshotOf([makeForecast({ pool: { stakedTvlUsd: 100_000 }, predictedFeesUsd: 5_000 })]);
    const report = recommendLpDeposits(snapshot, 1, { minStakedTvlUsd: 0 });
    expect(report.opportunities[0].note).toMatch(/accrue to veAERO voters, not stakers/);
    expect(report.opportunities[0].note).toContain("5,000");
  });

  it("respects maxPools", () => {
    const snapshot = snapshotOf(Array.from({ length: 5 }, () => makeForecast({ pool: { stakedTvlUsd: 100_000 } })));
    const report = recommendLpDeposits(snapshot, 1, { maxPools: 2, minStakedTvlUsd: 0 });
    expect(report.opportunities).toHaveLength(2);
  });
});

describe("detectVoteSwings", () => {
  const progress = epochProgress();

  function completedEpoch(epochsAgo: number, votes: number, bribesUsd: number): EpochStats {
    return { ts: currentEpochStart() - epochsAgo * WEEK, votes, emissions: 0, feesUsd: 0, bribesUsd };
  }
  function inProgressEpoch(votes: number, bribesUsd: number): EpochStats {
    return { ts: currentEpochStart(), votes, emissions: 0, feesUsd: 0, bribesUsd };
  }

  it("excludes pools with a dead gauge", () => {
    const snapshot = snapshotOf([
      makeForecast({
        pool: { gaugeAlive: false },
        history: [inProgressEpoch(1000, 1000), completedEpoch(1, 1000, 1000)],
      }),
    ]);
    const report = detectVoteSwings(snapshot);
    expect(report.risers).toHaveLength(0);
    expect(report.fallers).toHaveLength(0);
  });

  it("excludes pools with no in-progress epoch or no completed history to baseline against", () => {
    const noCurrent = snapshotOf([makeForecast({ history: [completedEpoch(1, 1000, 1000)] })]);
    expect(detectVoteSwings(noCurrent).risers).toHaveLength(0);

    const noBaseline = snapshotOf([makeForecast({ history: [inProgressEpoch(1000, 1000)] })]);
    expect(detectVoteSwings(noBaseline).risers).toHaveLength(0);
  });

  it("flags a brand-new bribe (no prior baseline) with a null ratio, not a bogus number", () => {
    const snapshot = snapshotOf([
      makeForecast({
        history: [
          inProgressEpoch(1000, 5000), // a bribe just appeared this epoch
          completedEpoch(1, 1000, 0),
          completedEpoch(2, 1000, 0),
        ],
      }),
    ]);
    const report = detectVoteSwings(snapshot);
    expect(report.risers).toHaveLength(1);
    expect(report.risers[0].bribeSpikeRatio).toBeNull();
    expect(report.risers[0].rationale).toMatch(/New bribe/);
  });

  it("computes bribeSpikeRatio against a pace-adjusted baseline", () => {
    // Flat $1000/epoch baseline; current epoch is already running at 2x the expected-so-far pace.
    const expectedSoFar = 1000 * progress;
    const snapshot = snapshotOf([
      makeForecast({
        history: [
          inProgressEpoch(1000, expectedSoFar * 2),
          completedEpoch(1, 1000, 1000),
          completedEpoch(2, 1000, 1000),
          completedEpoch(3, 1000, 1000),
        ],
      }),
    ]);
    const report = detectVoteSwings(snapshot);
    expect(report.risers).toHaveLength(1);
    expect(report.risers[0].bribeSpikeRatio).toBeCloseTo(2, 1);
  });

  it("computes a negative voteSwingPct for a pool losing votes vs its normal pace", () => {
    const expectedVotesSoFar = 1000 * progress;
    const snapshot = snapshotOf([
      makeForecast({
        history: [
          inProgressEpoch(expectedVotesSoFar * 0.5, 0),
          completedEpoch(1, 1000, 0),
          completedEpoch(2, 1000, 0),
        ],
      }),
    ]);
    const report = detectVoteSwings(snapshot);
    expect(report.fallers).toHaveLength(1);
    expect(report.fallers[0].voteSwingPct).toBeCloseTo(-50, 0);
  });

  it("excludes pools whose bribes/votes are on-pace from risers/fallers", () => {
    const expectedSoFar = 1000 * progress;
    const snapshot = snapshotOf([
      makeForecast({
        history: [
          inProgressEpoch(expectedSoFar, expectedSoFar), // exactly on pace
          completedEpoch(1, 1000, 1000),
          completedEpoch(2, 1000, 1000),
        ],
      }),
    ]);
    const report = detectVoteSwings(snapshot);
    expect(report.risers).toHaveLength(0);
    expect(report.fallers).toHaveLength(0);
  });

  it("sorts risers with brand-new bribes first, then by spike ratio descending", () => {
    const expectedSoFar = 1000 * progress;
    const snapshot = snapshotOf([
      makeForecast({
        history: [
          inProgressEpoch(1000, expectedSoFar * 1.5), // 1.5x pace, has a baseline
          completedEpoch(1, 1000, 1000),
          completedEpoch(2, 1000, 1000),
        ],
      }),
      makeForecast({
        history: [
          inProgressEpoch(1000, 5000), // brand new, no baseline
          completedEpoch(1, 1000, 0),
          completedEpoch(2, 1000, 0),
        ],
      }),
    ]);
    const report = detectVoteSwings(snapshot);
    expect(report.risers).toHaveLength(2);
    expect(report.risers[0].bribeSpikeRatio).toBeNull();
    expect(report.risers[1].bribeSpikeRatio).not.toBeNull();
  });

  it("respects maxPools", () => {
    const expectedSoFar = 1000 * progress;
    const snapshot = snapshotOf(
      Array.from({ length: 5 }, () =>
        makeForecast({
          history: [
            inProgressEpoch(1000, expectedSoFar * 3),
            completedEpoch(1, 1000, 1000),
            completedEpoch(2, 1000, 1000),
          ],
        }),
      ),
    );
    const report = detectVoteSwings(snapshot, { maxPools: 2 });
    expect(report.risers).toHaveLength(2);
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
