import { describe, expect, it } from "vitest";
import { detectAlerts, type AlertState, type WatchedPool } from "./alerts.js";

const pool = (over: Partial<WatchedPool> = {}): WatchedPool => ({
  pool: "0xaaa",
  symbol: "AAA/USDC",
  rank: 1,
  votes: 100_000,
  edgePct: 1,
  ...over,
});
const state = (pools: WatchedPool[], epochStart = 1000): AlertState => ({ epochStart, takenAt: "t", pools });

describe("detectAlerts", () => {
  it("says nothing without an earlier reading, or across an epoch flip", () => {
    const curr = state([pool({ votes: 900_000 })], 2000);
    expect(detectAlerts(null, curr)).toEqual([]);
    expect(detectAlerts(state([pool()], 1000), curr)).toEqual([]);
  });

  it("flags a pool whose votes at least doubled, naming its rank and the before/after", () => {
    const alerts = detectAlerts(state([pool()]), state([pool({ votes: 260_000 })]));
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ kind: "votes_surge", rank: 1 });
    expect(alerts[0].text).toContain("#1 in your split");
    expect(alerts[0].text).toContain("2.6x");
    expect(alerts[0].text).toContain("100,000 → 260,000 ve");
  });

  it("stays quiet for growth under the ratio, or under the absolute floor", () => {
    expect(detectAlerts(state([pool()]), state([pool({ votes: 190_000 })]))).toEqual([]); // 1.9x
    expect(detectAlerts(state([pool({ votes: 3 })]), state([pool({ votes: 8 })]))).toEqual([]); // 2.7x of nothing
  });

  it("treats an option passed as undefined as the default, not as 'never'", () => {
    const alerts = detectAlerts(state([pool()]), state([pool({ votes: 260_000 })]), {
      surgeRatio: undefined,
      minVoteIncrease: undefined,
      edgeDeadbandPp: undefined,
    });
    expect(alerts.map((a) => a.kind)).toEqual(["votes_surge"]);
  });

  it("honours a configured floor", () => {
    expect(detectAlerts(state([pool()]), state([pool({ votes: 260_000 })]), { minVoteIncrease: 500_000 })).toEqual([]);
  });

  it("handles a gauge that had no votes before", () => {
    const alerts = detectAlerts(state([pool({ votes: 0 })]), state([pool({ votes: 50_000 })]));
    expect(alerts[0].text).toContain("far more");
  });

  it("flags an edge that crossed zero, in either direction, with the right wording", () => {
    const down = detectAlerts(state([pool({ edgePct: 0.8 })]), state([pool({ edgePct: -0.3 })]));
    expect(down[0]).toMatchObject({ kind: "edge_flipped" });
    expect(down[0].text).toContain("+0.80pp → -0.30pp");
    expect(down[0].text).toContain("over-incentivized");

    const up = detectAlerts(state([pool({ edgePct: -0.4 })]), state([pool({ edgePct: 0.5 })]));
    expect(up[0].text).toContain("under-incentivized");
  });

  it("ignores wobble inside the deadband and moves that don't cross zero", () => {
    expect(detectAlerts(state([pool({ edgePct: 0.03 })]), state([pool({ edgePct: -0.03 })]))).toEqual([]);
    expect(detectAlerts(state([pool({ edgePct: 2 })]), state([pool({ edgePct: 0.4 })]))).toEqual([]);
  });

  it("skips pools with no earlier reading (newly in the split) and matches addresses case-insensitively", () => {
    const prev = state([pool({ pool: "0xABC", votes: 100_000 })]);
    const curr = state([pool({ pool: "0xabc", votes: 250_000 }), pool({ pool: "0xnew", symbol: "NEW", rank: 2, votes: 9e9 })]);
    const alerts = detectAlerts(prev, curr);
    expect(alerts.map((a) => a.pool)).toEqual(["0xabc"]);
  });

  it("orders alerts with the #1 pool first", () => {
    const prev = state([pool({ pool: "0x1", rank: 1 }), pool({ pool: "0x2", symbol: "TWO", rank: 2 })]);
    const curr = state([pool({ pool: "0x2", symbol: "TWO", rank: 2, votes: 300_000 }), pool({ pool: "0x1", rank: 1, votes: 300_000 })]);
    expect(detectAlerts(prev, curr).map((a) => a.rank)).toEqual([1, 2]);
  });
});

import { alertStateFromDashboard } from "./alerts.js";

describe("alertStateFromDashboard", () => {
  it("watches the voter_roi split, ranked by weight rather than by response order", () => {
    const s = alertStateFromDashboard({
      epochStart: 1000,
      generatedAt: 1_700_000_000_000,
      voterAlloc: {
        allocations: [
          { pool: "0x2", symbol: "SMALL", weightPct: 20, currentVotes: 5, predictiveEdgePct: -1 },
          { pool: "0x1", symbol: "BIG", weightPct: 80, currentVotes: 9, predictiveEdgePct: 2 },
        ],
      },
    });
    expect(s.pools.map((p) => [p.symbol, p.rank, p.votes, p.edgePct])).toEqual([
      ["BIG", 1, 9, 2],
      ["SMALL", 2, 5, -1],
    ]);
    expect(s.epochStart).toBe(1000);
  });
});
