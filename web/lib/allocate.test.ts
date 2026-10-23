import { decodeFunctionData } from "viem";
import { describe, expect, it } from "vitest";
import { AllocateError, allocateAbi, encodeAllocate, MAX_GAUGES, planAllocation, ZERO_GAUGE } from "./allocate";
import { SAERO } from "./saero";

const A = "0x0000000000000000000000000000000000000a01" as const;
const B = "0x0000000000000000000000000000000000000b02" as const;
const C = "0x00000000000000000000000000000000000000c3" as const;
const OWNER = "0x00000000000000000000000000000000000000f4" as const;
const E18 = 10n ** 18n;

describe("planAllocation", () => {
  it("splits parked power exactly, sorted ascending, remainder to the largest", () => {
    const p = planAllocation({ tokenId: 7n, parked: 100n * E18 + 1n, onBase: 0n, picks: [{ gauge: B, pct: 50 }, { gauge: A, pct: 30 }, { gauge: C, pct: 20 }] });
    expect(p.gauges.map((g) => g.gauge.toLowerCase())).toEqual([A, C, B].sort((x, y) => (BigInt(x) < BigInt(y) ? -1 : 1)));
    expect(p.gauges.reduce((a, g) => a + g.allocated, 0n)).toBe(100n * E18 + 1n);
    expect(p.idle).toBe(0n);
    expect(p.delta).toBe(100n * E18 + 1n);
  });
  it("counts power already on Base in the budget and moves only the parked part", () => {
    const p = planAllocation({ tokenId: 1n, parked: 10n, onBase: 90n, picks: [{ gauge: A, pct: 100 }] });
    expect(p.chainTotal).toBe(100n);
    expect(p.delta).toBe(10n);
    expect(p.gauges.map((g) => [g.gauge.toLowerCase(), g.allocated])).toEqual([[A, 100n]]);
  });
  it("keeps the unallocated share as an explicit first ZERO_GAUGE entry", () => {
    const p = planAllocation({ tokenId: 1n, parked: 1000n, onBase: 0n, picks: [{ gauge: A, pct: 60 }] });
    expect(p.gauges[0]).toEqual({ gauge: ZERO_GAUGE, allocated: 400n });
    expect(p.gauges[1].allocated).toBe(600n);
  });
  it.each([
    [[], "Pick at least one"],
    [[{ gauge: A, pct: 60 }, { gauge: B, pct: 50 }], "more than 100"],
    [[{ gauge: A, pct: 50 }, { gauge: A, pct: 50 }], "once"],
    [[{ gauge: A, pct: 0 }], "above 0"],
    [[{ gauge: ZERO_GAUGE, pct: 100 }], "Not a gauge"],
  ])("rejects bad picks %#", (picks, msg) => {
    expect(() => planAllocation({ tokenId: 1n, parked: 1000n, onBase: 0n, picks })).toThrow(new RegExp(msg));
  });
  it("rejects an empty budget and too many gauges", () => {
    expect(() => planAllocation({ tokenId: 1n, parked: 0n, onBase: 0n, picks: [{ gauge: A, pct: 100 }] })).toThrow(AllocateError);
    const many = Array.from({ length: MAX_GAUGES + 1 }, (_, i) => ({ gauge: `0x${(i + 1).toString(16).padStart(40, "0")}` as `0x${string}`, pct: 1 }));
    expect(() => planAllocation({ tokenId: 1n, parked: 10n ** 20n, onBase: 0n, picks: many })).toThrow(/At most/);
  });
});

describe("encodeAllocate", () => {
  it("targets the Voter with no ETH and round-trips through the ABI", () => {
    const plan = planAllocation({ tokenId: 6045n, parked: 62n * E18, onBase: 0n, picks: [{ gauge: A, pct: 70 }, { gauge: B, pct: 30 }] });
    const tx = encodeAllocate(plan, OWNER);
    expect(tx.to).toBe(SAERO.voter);
    expect(tx.value).toBe(0n);
    const { functionName, args } = decodeFunctionData({ abi: allocateAbi, data: tx.data });
    expect(functionName).toBe("allocate");
    const [id, chains, gaugesD, refund] = args as readonly [bigint, any[], any[], string];
    expect(id).toBe(6045n);
    expect(chains).toEqual([{ chainId: 8453n, delta: 62n * E18, gasLimit: 0n, value: 0n }]);
    expect(gaugesD).toHaveLength(1);
    expect(gaugesD[0].chainId).toBe(8453n);
    expect(gaugesD[0].gauges.reduce((a: bigint, g: any) => a + g.allocated, 0n)).toBe(62n * E18);
    expect(refund.toLowerCase()).toBe(OWNER);
  });
  it("sends no chain dispatch when nothing is parked", () => {
    const plan = planAllocation({ tokenId: 1n, parked: 0n, onBase: 50n, picks: [{ gauge: A, pct: 100 }] });
    const { args } = decodeFunctionData({ abi: allocateAbi, data: encodeAllocate(plan, OWNER).data });
    expect((args as any)[1]).toEqual([]);
  });
});
