import { describe, expect, it } from "vitest";
import { allocatedPower, chainShares, depositUsdPerDay, poolUsdPerDay, type AutopilotPool } from "./autopilot";

const gauge = (allocated: number, rate: number, weight: number, priced = true) => ({ gauge: "0xg", label: "G", allocated, rateUsdPerDay: rate, weight, priced });

// A pool of 1,000,000 power: 600,000 on a Base gauge paying $1,000/day that holds 2,000,000 in all, 300,000 on an OP gauge paying $600/day
// that holds 1,000,000, and 100,000 idle.
const pool: AutopilotPool = {
  tokenId: "20366",
  power: 1_000_000,
  chains: [
    { chainId: 8453, name: "Base", gauges: [gauge(600_000, 1000, 2_000_000)] },
    { chainId: 10, name: "OP", gauges: [gauge(300_000, 600, 1_000_000)] },
  ],
};

describe("poolUsdPerDay", () => {
  it("adds up each gauge's rate times the pool's share of it", () => {
    // 1000 x 0.3 + 600 x 0.3 = 480
    expect(poolUsdPerDay(pool)).toBeCloseTo(480, 6);
    expect(allocatedPower(pool)).toBe(900_000);
  });
  it("counts a gauge with no estimate as earning nothing", () => {
    expect(poolUsdPerDay({ ...pool, chains: [{ chainId: 8453, name: "Base", gauges: [gauge(600_000, 1000, 2_000_000, false)] }] })).toBe(0);
  });
});

describe("depositUsdPerDay", () => {
  it("is close to your share of the pool's earnings for an amount small next to the pool", () => {
    // 10,000 is 1% of the pool: about 1% of $480, a little less because the deposit dilutes each gauge too.
    const got = depositUsdPerDay(pool, 10_000);
    expect(got).toBeLessThan(4.8);
    expect(got).toBeGreaterThan(4.7);
  });
  it("matches the exact formula: the pool grows pro rata and the depositor gets a / (P + a)", () => {
    const a = 1_000_000; // doubling the pool
    // Base gauge: alloc 1.2M of weight 2.6M; OP gauge: alloc 0.6M of weight 1.3M. Pool earns 1000 x 1.2/2.6 + 600 x 0.6/1.3; you get half.
    const want = 0.5 * (1000 * (1.2 / 2.6) + 600 * (0.6 / 1.3));
    expect(depositUsdPerDay(pool, a)).toBeCloseTo(want, 6);
  });
  it("is zero for no amount or an empty pool", () => {
    expect(depositUsdPerDay(pool, 0)).toBe(0);
    expect(depositUsdPerDay({ ...pool, power: 0 }, 10)).toBe(0);
  });
});

describe("chainShares", () => {
  it("gives each chain's share of the pool's power and the idle rest", () => {
    const s = chainShares(pool);
    expect(s.chains.map((c) => [c.name, Math.round(c.pct)])).toEqual([["Base", 60], ["OP", 30]]);
    expect(Math.round(s.idlePct)).toBe(10);
  });
});
