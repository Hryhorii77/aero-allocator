import { describe, expect, it } from "vitest";
import { blendVotes, computePositionDelta, type PoolRate } from "./position.js";

const rates = (entries: Array<[string, number, string?]>): Map<string, PoolRate> =>
  new Map(entries.map(([pool, rewardPer1kVotesUsd, symbol]) => [pool, { symbol: symbol ?? pool.toUpperCase(), rewardPer1kVotesUsd }]));

describe("computePositionDelta", () => {
  it("reports not-voted when the veNFT has no current split", () => {
    const d = computePositionDelta({
      currentVotes: [],
      votingPower: 10_000,
      recommended: [{ pool: "0xa", symbol: "A", weightPct: 100, expectedRewardUsd: 50 }],
      poolRates: rates([["0xa", 5]]),
    });
    expect(d.hasVoted).toBe(false);
    expect(d.currentPoolCount).toBe(0);
  });

  it("prices the stay side from each held pool's $/1k rate and the voter's own votes there", () => {
    // 10,000 ve split 50/50 = 5,000 votes each = 5 units of 1k.
    // 0xa at $2/1k = $10, 0xb at $4/1k = $20 → $30 total.
    const d = computePositionDelta({
      currentVotes: [
        { pool: "0xa", weightPct: 50 },
        { pool: "0xb", weightPct: 50 },
      ],
      votingPower: 10_000,
      recommended: [],
      poolRates: rates([
        ["0xa", 2],
        ["0xb", 4],
      ]),
    });
    expect(d.estimateIfStayUsd).toBeCloseTo(30, 10);
  });

  it("takes the switch side from the recommendation's own expectedRewardUsd", () => {
    const d = computePositionDelta({
      currentVotes: [{ pool: "0xa", weightPct: 100 }],
      votingPower: 1_000,
      recommended: [
        { pool: "0xa", symbol: "A", weightPct: 60, expectedRewardUsd: 18 },
        { pool: "0xb", symbol: "B", weightPct: 40, expectedRewardUsd: 12 },
      ],
      poolRates: rates([
        ["0xa", 5],
        ["0xb", 9],
      ]),
    });
    expect(d.estimateIfSwitchUsd).toBeCloseTo(30, 10);
    expect(d.estimateIfStayUsd).toBeCloseTo(5, 10);
    expect(d.deltaUsd).toBeCloseTo(25, 10);
  });

  it("differences after rounding each side, so the delta reconciles with the printed cents", () => {
    // Raw: 27.484 − 10.474 = 17.010. Printed sides: 27.48 and 10.47, whose
    // difference is 17.01 — a raw difference would print 17.01 here but can
    // land a cent off in general; this pins the rounding order.
    const d = computePositionDelta({
      currentVotes: [{ pool: "0xa", weightPct: 100 }],
      votingPower: 1_000,
      recommended: [{ pool: "0xb", symbol: "B", weightPct: 100, expectedRewardUsd: 27.484 }],
      poolRates: rates([
        ["0xa", 10.474],
        ["0xb", 1],
      ]),
    });
    expect(d.deltaUsd).toBeCloseTo(17.01, 10);
    // Exactly the subtraction a reader does from the two displayed figures.
    expect(d.deltaUsd).toBeCloseTo(
      Math.round(d.estimateIfSwitchUsd * 100) / 100 - Math.round(d.estimateIfStayUsd * 100) / 100,
      10,
    );
  });

  it("flags the comparison as incomparable when a held pool has no rate, naming the pool", () => {
    // The whole point: an unpriced held pool makes "stay" an undercount, so
    // the delta would overstate the gain from switching by exactly the
    // amount we failed to measure. Callers must withhold it.
    const d = computePositionDelta({
      currentVotes: [
        { pool: "0xa", weightPct: 50 },
        { pool: "0xdelisted", weightPct: 50 },
      ],
      votingPower: 10_000,
      recommended: [{ pool: "0xa", symbol: "A", weightPct: 100, expectedRewardUsd: 40 }],
      poolRates: rates([["0xa", 2]]),
    });
    expect(d.comparable).toBe(false);
    expect(d.unpricedPools).toEqual(["0xdelisted"]);
  });

  it("stays comparable when the unpriced pool is only in the recommendation, not the current split", () => {
    // Nothing is undercounted on the stay side, so the delta is still honest.
    const d = computePositionDelta({
      currentVotes: [{ pool: "0xa", weightPct: 100 }],
      votingPower: 10_000,
      recommended: [{ pool: "0xnew", symbol: "NEW", weightPct: 100, expectedRewardUsd: 40 }],
      poolRates: rates([["0xa", 2]]),
    });
    expect(d.comparable).toBe(true);
  });

  it("matches pools case-insensitively across the two sides", () => {
    // veSugar returns checksummed addresses; the forecast lowercases them.
    // A case mismatch would double-count the same pool as two rows.
    const d = computePositionDelta({
      currentVotes: [{ pool: "0xAbCd", weightPct: 100 }],
      votingPower: 1_000,
      recommended: [{ pool: "0xabcd", symbol: "A", weightPct: 100, expectedRewardUsd: 9 }],
      poolRates: rates([["0xabcd", 3]]),
    });
    expect(d.rows).toHaveLength(1);
    expect(d.rows[0].currentPct).toBe(100);
    expect(d.rows[0].recommendedPct).toBe(100);
  });

  it("counts pools on each side independently, including ones held but not recommended", () => {
    const d = computePositionDelta({
      currentVotes: [
        { pool: "0xa", weightPct: 60 },
        { pool: "0xb", weightPct: 40 },
      ],
      votingPower: 1_000,
      recommended: [
        { pool: "0xa", symbol: "A", weightPct: 34, expectedRewardUsd: 1 },
        { pool: "0xc", symbol: "C", weightPct: 33, expectedRewardUsd: 1 },
        { pool: "0xd", symbol: "D", weightPct: 33, expectedRewardUsd: 1 },
      ],
      poolRates: rates([
        ["0xa", 1],
        ["0xb", 1],
        ["0xc", 1],
        ["0xd", 1],
      ]),
    });
    expect(d.currentPoolCount).toBe(2);
    expect(d.recommendedPoolCount).toBe(3);
    expect(d.rows).toHaveLength(4);
  });

  it("returns a negative delta when the current split already beats the recommendation", () => {
    // Not a hypothetical: a voter sitting in one fat bribed pool can out-earn
    // a diversified split. Printing a positive number here would be a lie
    // that costs the user money.
    const d = computePositionDelta({
      currentVotes: [{ pool: "0xa", weightPct: 100 }],
      votingPower: 10_000,
      recommended: [{ pool: "0xb", symbol: "B", weightPct: 100, expectedRewardUsd: 5 }],
      poolRates: rates([
        ["0xa", 9],
        ["0xb", 1],
      ]),
    });
    expect(d.estimateIfStayUsd).toBeCloseTo(90, 10);
    expect(d.deltaUsd).toBeCloseTo(-85, 10);
  });

  it("treats a recommendation row with no expectedRewardUsd as contributing nothing", () => {
    // protocol_efficiency / edge_hunter rows carry no expectedRewardUsd at
    // all; summing undefined as 0 keeps the switch side from going NaN.
    const d = computePositionDelta({
      currentVotes: [{ pool: "0xa", weightPct: 100 }],
      votingPower: 1_000,
      recommended: [{ pool: "0xb", symbol: "B", weightPct: 100 }],
      poolRates: rates([
        ["0xa", 4],
        ["0xb", 4],
      ]),
    });
    expect(d.estimateIfSwitchUsd).toBe(0);
    expect(Number.isNaN(d.deltaUsd)).toBe(false);
  });
});

describe("blendVotes", () => {
  it("returns an empty split for no locks", () => {
    expect(blendVotes([])).toEqual({ votingPower: 0, votes: [] });
  });

  it("passes a single lock's split through unchanged", () => {
    const r = blendVotes([{ votingPower: 1_000, votes: [{ pool: "0xa", weightPct: 100 }] }]);
    expect(r).toEqual({ votingPower: 1_000, votes: [{ pool: "0xa", weightPct: 100 }] });
  });

  it("weights each lock's split by its own voting power, not equally", () => {
    // A 9,000 lock fully in 0xa and a 1,000 lock fully in 0xb is 90/10 —
    // averaging the two splits equally would say 50/50 and misprice the
    // whole position.
    const r = blendVotes([
      { votingPower: 9_000, votes: [{ pool: "0xa", weightPct: 100 }] },
      { votingPower: 1_000, votes: [{ pool: "0xb", weightPct: 100 }] },
    ]);
    expect(r.votingPower).toBe(10_000);
    expect(r.votes).toEqual([
      { pool: "0xa", weightPct: 90 },
      { pool: "0xb", weightPct: 10 },
    ]);
  });

  it("merges the same pool across locks into one row, case-insensitively", () => {
    // veSugar returns checksummed addresses per NFT; two locks voting the
    // same pool must not surface as two rows that each look like half a
    // position.
    const r = blendVotes([
      { votingPower: 500, votes: [{ pool: "0xAbCd", weightPct: 100 }] },
      { votingPower: 500, votes: [{ pool: "0xabcd", weightPct: 100 }] },
    ]);
    expect(r.votes).toEqual([{ pool: "0xabcd", weightPct: 100 }]);
  });

  it("does not credit weight for a lock that hasn't voted, but still counts its power", () => {
    // An unvoted lock dilutes the blended percentages — it is voting power
    // sitting idle, and hiding that would overstate how concentrated the
    // voted half is.
    const r = blendVotes([
      { votingPower: 1_000, votes: [{ pool: "0xa", weightPct: 100 }] },
      { votingPower: 1_000, votes: [] },
    ]);
    expect(r.votingPower).toBe(2_000);
    expect(r.votes).toEqual([{ pool: "0xa", weightPct: 50 }]);
  });
});
