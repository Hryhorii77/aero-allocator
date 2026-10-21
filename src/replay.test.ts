import { describe, expect, it } from "vitest";
import { replayVoterRoi } from "./replay.js";
import type { MarketSnapshot } from "./scoring.js";
import { WEEK, epochStart } from "./config.js";
import type { EpochStats, PoolForecast, PoolInfo } from "./types.js";

// Fixed clock: mid-epoch, so the newest history entry is the in-progress one.
const NOW = epochStart(1_790_000_000) + WEEK / 2;
const CURRENT = epochStart(NOW);
const ago = (k: number) => CURRENT - k * WEEK;

let lpCounter = 0;
function pool(overrides: Partial<PoolInfo> = {}): PoolInfo {
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

/** `epochs[k]` is the epoch k weeks ago (k = 0 is the in-progress one). */
function forecast(p: PoolInfo, epochs: Array<Partial<EpochStats>>): PoolForecast {
  const history = epochs.map((e, k) => ({ ts: ago(k), votes: 100_000, emissions: 0, feesUsd: 0, bribesUsd: 0, ...e }));
  return {
    pool: p,
    history,
    predictedFeesUsd: 0,
    lastEpochFeesUsd: 0,
    feeTrendUsdPerEpoch: 0,
    currentBribesUsd: 0,
    currentVotes: 0,
    voteShare: 0,
    predictedDemandShare: 0,
    predictiveEdge: 0,
    rewardPer1kVotesUsd: 0,
    confidence: 0.8,
  };
}

const steady = (feesUsd: number, votes = 100_000) => Array.from({ length: 8 }, () => ({ feesUsd, votes }));

function snap(...forecasts: PoolForecast[]): MarketSnapshot {
  return { generatedAt: NOW * 1000, forecasts };
}

describe("replayVoterRoi", () => {
  it("replays only settled epochs with enough trailing history, newest first", () => {
    // 8 entries: in-progress + 7 settled. Needs 2 trailing epochs, so the
    // oldest two settled epochs can't be replayed: 5 remain.
    const r = replayVoterRoi(snap(forecast(pool(), steady(5_000))), 10_000, { now: NOW, epochs: 10 });
    expect(r.epochs.map((e) => e.epochStart)).toEqual([ago(1), ago(2), ago(3), ago(4), ago(5)]);
  });

  it("scores a replayed vote with the pro-rata payout on what the epoch actually paid", () => {
    const only = forecast(pool(), steady(5_000));
    only.history[1] = { ...only.history[1], feesUsd: 9_000, bribesUsd: 1_000, votes: 190_000 };
    const r = replayVoterRoi(snap(only), 10_000, { now: NOW, epochs: 1 });
    // One pool gets every vote: 10,000 × 10,000 / (190,000 + 10,000) = 500.
    expect(r.epochs[0].splitRealizedUsd).toBe(500);
    expect(r.epochs[0].topPoolRealizedUsd).toBe(500);
    expect(r.vsTopPoolPct).toBe(0);
  });

  it("chooses the split without looking at the epoch being scored", () => {
    const build = (surprise: number) => {
      lpCounter = 0;
      const a = forecast(pool(), steady(5_000));
      const b = forecast(pool(), steady(5_000));
      a.history[1] = { ...a.history[1], feesUsd: surprise };
      return replayVoterRoi(snap(a, b), 10_000, { now: NOW, epochs: 1 });
    };
    const calm = build(5_000);
    const spike = build(500_000);
    // Same decision (same pools, so the same expected $)...
    expect(spike.epochs[0].splitExpectedUsd).toBe(calm.epochs[0].splitExpectedUsd);
    expect(spike.epochs[0].splitPoolCount).toBe(calm.epochs[0].splitPoolCount);
    // ...different outcome, because only the outcome saw the spike.
    expect(spike.epochs[0].splitRealizedUsd).toBeGreaterThan(calm.epochs[0].splitRealizedUsd);
  });

  it("takes the baseline pool by last epoch's reward per vote, ignoring gauges under the reward floor", () => {
    const big = forecast(pool({ symbol: "BIG" }), steady(20_000, 1_000_000)); // $20/1k votes
    const rich = forecast(pool({ symbol: "RICH" }), steady(6_000, 100_000)); // $60/1k votes
    const dust = forecast(pool({ symbol: "DUST" }), steady(100, 10)); // $10,000/1k, but $100 < floor
    const r = replayVoterRoi(snap(big, rich, dust), 10_000, { now: NOW, epochs: 1 });
    expect(r.epochs[0].topPool?.symbol).toBe("RICH");
  });

  it("can report the split losing — the number isn't clamped to look good", () => {
    // Every other pool looked better last epoch; the one the baseline picks
    // then pays out hugely in the scored epoch.
    const winner = forecast(pool({ symbol: "WIN" }), steady(6_000, 100_000));
    const others = [1, 2, 3].map((i) => forecast(pool({ symbol: `O${i}` }), steady(5_900, 100_000)));
    winner.history[1] = { ...winner.history[1], feesUsd: 60_000 };
    for (const o of others) o.history[1] = { ...o.history[1], feesUsd: 100 };
    const r = replayVoterRoi(snap(winner, ...others), 10_000, { now: NOW, epochs: 1 });
    expect(r.epochs[0].topPool?.symbol).toBe("WIN");
    expect(r.vsTopPoolPct).toBeLessThan(0);
    expect(r.epochsSplitWon).toBe(0);
  });

  it("returns a null comparison rather than a division by zero when the baseline had nothing to pick", () => {
    const tiny = forecast(pool(), steady(100)); // under the floor for both sides
    const r = replayVoterRoi(snap(tiny), 10_000, { now: NOW, epochs: 2 });
    expect(r.topPoolRealizedUsd).toBe(0);
    expect(r.vsTopPoolPct).toBeNull();
  });

  it("sums what the model promised and what was paid, as a share", () => {
    const only = forecast(pool(), steady(5_000));
    const r = replayVoterRoi(snap(only), 10_000, { now: NOW, epochs: 2 });
    const promised = r.epochs.reduce((s, e) => s + e.splitExpectedUsd, 0);
    expect(r.splitExpectedUsd).toBeCloseTo(promised, 1);
    expect(r.paidOfPromisedPct).toBeCloseTo((r.splitRealizedUsd / r.splitExpectedUsd) * 100, 0);
  });

  describe("survival", () => {
    // 8 pools, pool i pays (i+1)×$1000 a week on 100k votes, every epoch.
    const ladder = () => {
      lpCounter = 0;
      return Array.from({ length: 8 }, (_, i) => forecast(pool({ symbol: `P${i}` }), steady((i + 1) * 1_000)));
    };

    it("counts how many predicted-top pools were still top once the epoch settled", () => {
      const r = replayVoterRoi(snap(...ladder()), 10_000, { now: NOW, epochs: 1 });
      // Nothing changes week to week, so every predicted-top pool survives.
      expect(r.epochs[0].survival).toEqual({ topN: 4, stillTop: 4 });
    });

    it("drops a pool that fell out of the top when its epoch actually paid", () => {
      const pools = ladder();
      // The pool predicted best (P7) pays almost nothing in the scored epoch.
      pools[7].history[1] = { ...pools[7].history[1], feesUsd: 10 };
      const r = replayVoterRoi(snap(...pools), 10_000, { now: NOW, epochs: 1 });
      expect(r.epochs[0].survival).toEqual({ topN: 4, stillTop: 3 });
    });

    it("is null when there are too few pools to say anything", () => {
      const r = replayVoterRoi(snap(forecast(pool(), steady(5_000))), 10_000, { now: NOW, epochs: 1 });
      expect(r.epochs[0].survival).toBeNull();
    });
  });
});
