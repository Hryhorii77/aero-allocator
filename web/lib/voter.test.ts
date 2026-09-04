import { describe, expect, it } from "vitest";
import { decodeFunctionData, encodeFunctionData } from "viem";
import { buildVoteArgs, buildVoteCalldata, voterAbi } from "./voter";
import { DATA_SUFFIX } from "./attribution";

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

describe("buildVoteCalldata", () => {
  // Real, EIP-55-checksummed addresses — unlike buildVoteArgs (which never
  // touches viem's ABI encoder), encodeFunctionData validates checksums for
  // address[] params, so the placeholder-style "0xaaaa...aaaa" addresses
  // used above would fail here.
  const allocations = [
    { pool: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", weightPct: 50 }, // USDC on Base
    { pool: "0x940181a94A35A4569E4529A3CDfB74e38FD98631", weightPct: 50 }, // AERO
  ];

  it("appends the ERC-8021 attribution suffix to the end of the encoded calldata", () => {
    const calldata = buildVoteCalldata("123", allocations);
    expect(calldata.endsWith(DATA_SUFFIX.slice(2))).toBe(true);
  });

  it("still decodes to the exact same vote() args as buildVoteArgs — the suffix doesn't corrupt the call", () => {
    const calldata = buildVoteCalldata("123", allocations);
    // decodeFunctionData only reads the ABI-expected arguments; trailing
    // attribution bytes are exactly what it's supposed to ignore.
    const decoded = decodeFunctionData({ abi: voterAbi, data: calldata });
    expect(decoded.functionName).toBe("vote");
    expect(decoded.args).toEqual(buildVoteArgs("123", allocations));
  });

  it("adds exactly the suffix's byte length on top of the unsuffixed encoding", () => {
    const unsuffixed = encodeFunctionData({ abi: voterAbi, functionName: "vote", args: buildVoteArgs("123", allocations) });
    const calldata = buildVoteCalldata("123", allocations);
    expect(calldata.length - unsuffixed.length).toBe(DATA_SUFFIX.length - 2); // -2: DATA_SUFFIX's own "0x" isn't duplicated
    expect(calldata.startsWith(unsuffixed)).toBe(true);
  });
});
