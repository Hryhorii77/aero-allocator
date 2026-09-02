import { describe, expect, it } from "vitest";
import { buildVoteArgs } from "./voter";

describe("buildVoteArgs", () => {
  it("converts the tokenId to a bigint and pool addresses pass through unchanged", () => {
    const [tokenId, pools] = buildVoteArgs("12345", [
      { pool: "0xaaaa000000000000000000000000000000aaaa", weightPct: 50 },
      { pool: "0xbbbb000000000000000000000000000000bbbb", weightPct: 50 },
    ]);
    expect(tokenId).toBe(12345n);
    expect(pools).toEqual(["0xaaaa000000000000000000000000000000aaaa", "0xbbbb000000000000000000000000000000bbbb"]);
  });

  it("scales weightPct by 100 to preserve two decimal places", () => {
    const [, , weights] = buildVoteArgs("1", [{ pool: "0xaaaa", weightPct: 33.33 }]);
    expect(weights).toEqual([3333n]);
  });

  it("does not silently truncate a fractional weight below one unit at ×100 scale", () => {
    // At raw scale (no ×100), 0.4 would round to 0 and that pool would get
    // zero votes despite a nonzero allocation — the ×100 scaling is what
    // prevents that.
    const [, , weights] = buildVoteArgs("1", [{ pool: "0xaaaa", weightPct: 0.4 }]);
    expect(weights[0]).toBeGreaterThan(0n);
    expect(weights).toEqual([40n]);
  });

  it("rounds to the nearest integer at ×100 scale rather than truncating", () => {
    const [, , weights] = buildVoteArgs("1", [{ pool: "0xaaaa", weightPct: 12.345 }]);
    // 12.345 * 100 = 1234.5 -> rounds to 1235, not truncates to 1234.
    expect(weights).toEqual([1235n]);
  });

  it("preserves allocation order across pools and weights", () => {
    const allocations = [
      { pool: "0x1", weightPct: 10 },
      { pool: "0x2", weightPct: 20 },
      { pool: "0x3", weightPct: 70 },
    ];
    const [, pools, weights] = buildVoteArgs("1", allocations);
    expect(pools).toEqual(["0x1", "0x2", "0x3"]);
    expect(weights).toEqual([1000n, 2000n, 7000n]);
  });
});
