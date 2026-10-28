import { describe, expect, it } from "vitest";
import { decodeFunctionData, encodeFunctionData } from "viem";
import { allocateAbi, AllocateError, DEALLOC_GAUGE } from "./allocate";
import { gaugeStepGas } from "./allocate-fee";
import { planChainRegauge, planChainReturn } from "./allocate-manage";

const OWNER = "0x9b3F205E43dc9FcC1cc2Fe6d9dCD0357769A6Bae" as const;
const g = (n: number) => `0x${n.toString(16).padStart(40, "0")}` as const;
const E = 10n ** 18n;
const fees = { gaugeStepWei: (n: number) => 1000n + BigInt(n), returnCostWei: 145n };

describe("planChainReturn", () => {
  it("lists the chain's whole budget against the marker and carries the outbound fee plus the return cost", () => {
    const s = planChainReturn({ tokenId: 15308n, chainId: 5042, amount: 25n * E, fees, refundRecipient: OWNER });
    const [, chains, gauges] = s.args;
    expect(chains).toEqual([]);
    expect(gauges).toEqual([{ chainId: 5042n, gasLimit: gaugeStepGas(1), value: 1001n + 145n, gauges: [{ gauge: DEALLOC_GAUGE, allocated: 25n * E, data: "0x" }] }]);
    expect(s.valueWei).toBe(1146n);
    const data = encodeFunctionData({ abi: allocateAbi, functionName: "allocate", args: s.args });
    expect(decodeFunctionData({ abi: allocateAbi, data }).args).toEqual(s.args);
  });
  it("refuses Base and an empty chain", () => {
    expect(() => planChainReturn({ tokenId: 1n, chainId: 8453, amount: E, fees, refundRecipient: OWNER })).toThrow(AllocateError);
    expect(() => planChainReturn({ tokenId: 1n, chainId: 10, amount: 0n, fees, refundRecipient: OWNER })).toThrow(/Nothing/);
  });
});

describe("planChainRegauge", () => {
  it("overwrites the chain's list with gauges adding up to its whole budget, ascending, value by gauge count", () => {
    const s = planChainRegauge({ tokenId: 15308n, chainId: 10, amount: 100n * E, picks: [{ gauge: g(9), bps: 7000 }, { gauge: g(4), bps: 3000 }], fees, refundRecipient: OWNER });
    const [, chains, gauges] = s.args;
    expect(chains).toEqual([]);
    expect(gauges[0].gauges.map((x) => [x.gauge, x.allocated])).toEqual([[g(4), 30n * E], [g(9), 70n * E]]);
    expect(gauges[0].gauges.reduce((a, x) => a + x.allocated, 0n)).toBe(100n * E);
    expect(gauges[0]).toMatchObject({ chainId: 10n, gasLimit: gaugeStepGas(2), value: 1002n });
    expect(s.valueWei).toBe(1002n);
  });
  it("refuses plans the Voter would reject", () => {
    const base = { tokenId: 1n, chainId: 10, amount: 100n * E, fees, refundRecipient: OWNER };
    expect(() => planChainRegauge({ ...base, picks: [{ gauge: g(1), bps: 9000 }] })).toThrow(/100%/);
    expect(() => planChainRegauge({ ...base, picks: [] })).toThrow(/at least one/);
    expect(() => planChainRegauge({ ...base, picks: [{ gauge: g(1), bps: 5000 }, { gauge: g(1), bps: 5000 }] })).toThrow(/once/);
    expect(() => planChainRegauge({ ...base, chainId: 8453, picks: [{ gauge: g(1), bps: 10_000 }] })).toThrow(/Base/);
    expect(() => planChainRegauge({ ...base, amount: 5n, picks: [{ gauge: g(1), bps: 9999 }, { gauge: g(2), bps: 1 }] })).toThrow(/too small/);
  });
});
