import { describe, expect, it } from "vitest";
import { encodeFunctionData, parseAbi, toFunctionSelector } from "viem";
import { MIGRATION, NEW_ESCROW, OLD_ESCROW, SEL, buildTxs, classify, encodeAddress, encodeUint, toInt128, tokens, words } from "./upgrade.mjs";

const OWNER = "0x95A70CB198C4F4cf1f90B2995eeb8aE8E2dFE2fb";
const NOW = 1_793_000_000;
const ok = { paused: false, open: 1_792_620_000, remaining: 10n ** 27n, now: NOW };
const lock = (over = {}) => ({
  tokenId: 100000n,
  owner: OWNER,
  locked: { amount: 22_275_562_617_318_790n, end: 1_890_000_000n, isPermanent: false },
  voted: false,
  escrowType: 0,
  restricted: false,
  preview: { out: 22_275_562_617_318_790n, isPermanent: false, isLiquid: false },
  ...over,
});

describe("selectors and calldata agree with viem", () => {
  const sigs = {
    balanceOf: "balanceOf(address)",
    ownerToNFTokenIdList: "ownerToNFTokenIdList(address,uint256)",
    ownerOf: "ownerOf(uint256)",
    locked: "locked(uint256)",
    voted: "voted(uint256)",
    escrowType: "escrowType(uint256)",
    restricted: "restricted(uint256)",
    previewConversion: "previewConversion(uint256)",
    paused: "paused()",
    migrationOpen: "MIGRATION_OPEN()",
    remaining: "remaining()",
    getApproved: "getApproved(uint256)",
    isApprovedForAll: "isApprovedForAll(address,address)",
    approve: "approve(address,uint256)",
    depositVeNFT: "depositVeNFT(uint256,address)",
  };
  it("every selector is the function's real selector", () => {
    for (const [k, sig] of Object.entries(sigs)) expect(SEL[k], k).toBe(toFunctionSelector(sig));
  });
  it("the approve and deposit calldata equal viem's encoding, to the right contracts, with no ETH", () => {
    const [approve, deposit] = buildTxs(100000n, OWNER);
    expect(approve.to).toBe(OLD_ESCROW);
    expect(approve.data).toBe(encodeFunctionData({ abi: parseAbi(["function approve(address,uint256)"]), functionName: "approve", args: [MIGRATION, 100000n] }));
    expect(deposit.to).toBe(MIGRATION);
    expect(deposit.data).toBe(encodeFunctionData({ abi: parseAbi(["function depositVeNFT(uint256,address)"]), functionName: "depositVeNFT", args: [100000n, OWNER] }));
    for (const t of [approve, deposit]) expect([t.value, t.chainId]).toEqual(["0", 8453]);
    expect(buildTxs(7n, OWNER, { needsApproval: false }).map((t) => t.step)).toEqual(["depositVeNFT"]);
  });
  it("the addresses are the ones in Aero's deployment file and the web app", () => {
    expect(MIGRATION).toBe("0x22a2F7340a3fB4C7C389D91eE954766B12476721");
    expect(NEW_ESCROW).toBe("0xBF7977E1521e9a3032bf7243Ee4712f311f13915");
    expect(OLD_ESCROW).toBe("0xebf418Fe2512e7E6bd9b87a8F0f294aCDC67e6B4");
  });
  it("encodes and decodes words", () => {
    expect(encodeUint(100000n)).toBe("00000000000000000000000000000000000000000000000000000000000186a0");
    expect(encodeAddress(OWNER)).toHaveLength(64);
    expect(words("0x" + "00".repeat(31) + "01" + "00".repeat(31) + "02")).toEqual(["0x" + "00".repeat(31) + "01", "0x" + "00".repeat(31) + "02"]);
    expect(toInt128("0x" + "00".repeat(16) + "ff".repeat(16))).toBe(-1n);
    expect(toInt128("0x" + "00".repeat(31) + "05")).toBe(5n);
  });
  it("formats 18-decimal amounts", () => {
    expect(tokens(22_275_562_617_318_790n)).toBe("0.022275");
    expect(tokens(10n ** 18n)).toBe("1");
    expect(tokens(0n)).toBe("0");
  });
});

describe("classify", () => {
  it("a normal active lock is ready and becomes a sAERO position with the time rounded up to weeks", () => {
    const v = classify(lock(), ok);
    expect(v.status).toBe("ready");
    expect(v.blockers).toEqual([]);
    expect(v.outcome.kind).toBe("sAERO");
    expect(v.outcome.detail).toMatch(/rounded up to whole weeks.*2030-03-|2029-/);
    expect(v.warnings.join(" ")).toMatch(/Irreversible/);
    expect(v.warnings.join(" ")).toMatch(/Claim trading fees, incentives and the rebase/);
  });

  it("a permanent lock becomes a permanent sAERO position", () => {
    const v = classify(lock({ locked: { amount: 5n * 10n ** 18n, end: 0n, isPermanent: true } }), ok);
    expect(v.status).toBe("ready");
    expect(v.outcome.detail).toMatch(/permanent sAERO position/);
  });

  it("an expired lock becomes liquid AERO, and says it is not a sAERO position", () => {
    const v = classify(lock({ locked: { amount: 10n ** 18n, end: BigInt(NOW - 1), isPermanent: false } }), ok);
    expect(v.status).toBe("ready");
    expect(v.outcome.kind).toBe("liquid");
    expect(v.outcome.detail).toMatch(/NOT a sAERO position/);
    expect(v.warnings.join(" ")).toMatch(/no allocation power/);
  });

  it("blocks for each thing that makes the deposit revert", () => {
    const cases = [
      [lock({ voted: true }), /active votes/],
      [lock({ escrowType: 1 }), /Relay/],
      [lock({ escrowType: 2 }), /Relay/],
      [lock({ restricted: true }), /restricted list/],
      [lock({ locked: { amount: 0n, end: 1_890_000_000n, isPermanent: false } }), /Nothing is locked/],
    ];
    for (const [t, re] of cases) {
      const v = classify(t, ok);
      expect(v.status).toBe("blocked");
      expect(v.blockers.join(" ")).toMatch(re);
    }
    expect(classify(lock(), { ...ok, paused: true }).blockers.join(" ")).toMatch(/paused/);
    expect(classify(lock(), { ...ok, open: NOW + 10 }).blockers.join(" ")).toMatch(/not opened/);
    expect(classify(lock(), { ...ok, remaining: 1n }).blockers.join(" ")).toMatch(/budget/);
  });

  it("lists every blocker, not just the first", () => {
    const v = classify(lock({ voted: true, escrowType: 1, restricted: true }), ok);
    expect(v.blockers).toHaveLength(3);
  });

  it("falls back to the locked amount when the preview could not be read", () => {
    const v = classify(lock({ preview: null }), ok);
    expect(v.outcome.amount).toBe(22_275_562_617_318_790n);
  });
});
