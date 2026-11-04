import { describe, expect, it } from "vitest";
import { summariseEarned, type EarnedEntry } from "./earned";

const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;
const ZEC = "0xB2000000000000000000008501b13360000cb2EC" as const;
const G1 = "0x0000000000000000000000000000000000000001" as const;
const G2 = "0x0000000000000000000000000000000000000002" as const;
const meta = new Map([[USDC.toLowerCase(), { decimals: 6, symbol: "USDC" }], [ZEC.toLowerCase(), { decimals: 8, symbol: "cbZEC" }]]);

describe("summariseEarned", () => {
  it("adds a token across gauges, values it, and orders by dollars", () => {
    const entries: EarnedEntry[] = [
      { gauge: G1, token0: USDC, token1: ZEC, amount0: 26_386n, amount1: 2_398n },
      { gauge: G2, token0: USDC, token1: ZEC, amount0: 4_000_000n, amount1: 0n },
    ];
    const s = summariseEarned(entries, meta, { [USDC.toLowerCase()]: 1, [ZEC.toLowerCase()]: 400 });
    expect(s.lines.map((l) => l.symbol)).toEqual(["USDC", "cbZEC"]);
    expect(s.lines[0].amount).toBeCloseTo(4.026386);
    expect(s.totalUsd).toBeCloseTo(4.026386 + 0.00002398 * 400, 6);
    expect(s.unpriced).toBe(false);
  });
  it("skips zero amounts, marks an unpriced token and says the total is a floor", () => {
    const s = summariseEarned([{ gauge: G1, token0: USDC, token1: ZEC, amount0: 0n, amount1: 5_000n }], meta, {});
    expect(s.lines).toHaveLength(1);
    expect(s.lines[0]).toMatchObject({ symbol: "cbZEC", usd: null });
    expect(s.unpriced).toBe(true);
    expect(s.totalUsd).toBe(0);
  });
  it("leaves out a token it has no metadata for rather than guessing decimals", () => {
    expect(summariseEarned([{ gauge: G1, token0: USDC, token1: ZEC, amount0: 1n, amount1: 1n }], new Map(), {}).lines).toEqual([]);
  });
});

describe("summariseAmounts and chains", () => {
  it("drops dust that would print as zero", async () => {
    const { summariseAmounts } = await import("./earned");
    const AERO = "0x940181a94A35A4569E4529A3CDfB74e38FD98631" as const;
    const m = new Map([[AERO.toLowerCase(), { decimals: 18, symbol: "AERO" }]]);
    expect(summariseAmounts([{ token: AERO, amount: 10n ** 9n }], m, { [AERO.toLowerCase()]: 0.8 }).lines).toEqual([]);
    expect(summariseAmounts([{ token: AERO, amount: 10n ** 15n }], m, { [AERO.toLowerCase()]: 0.8 }).lines).toHaveLength(1);
  });
  it("keeps chains with anything unclaimed, largest first, and says 'at least' when programs were left out", async () => {
    const { chainTotal, combineChains } = await import("./earned");
    const empty = { lines: [], totalUsd: 0, unpriced: false };
    const some = (usd: number) => ({ lines: [{ token: USDC, symbol: "USDC", amount: usd, usd }], totalUsd: usd, unpriced: false });
    const all = combineChains([chainTotal(8453, "Base", some(1), some(2)), chainTotal(10, "OP", empty, empty), chainTotal(1, "Ethereum", some(5), empty)], ["Arc"], false);
    expect(all.chains.map((c) => [c.name, c.totalUsd])).toEqual([["Ethereum", 5], ["Base", 3]]);
    expect(all.totalUsd).toBe(8);
    expect(all.atLeast).toBe(false);
    expect(all.skipped).toEqual(["Arc"]);
    expect(combineChains([chainTotal(8453, "Base", some(1), empty)], [], true).atLeast).toBe(true);
  });
});
