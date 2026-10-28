import { describe, expect, it } from "vitest";
import { decodeFunctionData, encodeFunctionData, parseEther } from "viem";
import { allocateAbi, AllocateError, DEALLOC_GAUGE } from "./allocate";
import { CHAIN_STEP_GAS, gaugeStepGas } from "./allocate-fee";
import { planAcrossChains, withMargin, type CrossChainFees } from "./allocate-multichain";

const OWNER = "0x9b3F205E43dc9FcC1cc2Fe6d9dCD0357769A6Bae" as const;
const g = (n: number) => `0x${n.toString(16).padStart(40, "0")}` as const;
const E = 10n ** 18n;
const fees: CrossChainFees = { chainStepWei: (c) => BigInt(c) * 1_000n, gaugeStepWei: (c, n) => BigInt(c) * 10_000n + BigInt(n) };
const plan = (o: Partial<Parameters<typeof planAcrossChains>[0]>) =>
  planAcrossChains({ tokenId: 15308n, parked: 0n, onBase: 0n, targets: [], fees, currentBase: [], refundRecipient: OWNER, ...o });

describe("planAcrossChains", () => {
  it("sends idle power to Base and another chain in one call, values adding up to msg.value", () => {
    const steps = plan({
      parked: 1000n * E,
      targets: [
        { chainId: 8453, picks: [{ gauge: g(5), bps: 6000 }] },
        { chainId: 1, picks: [{ gauge: g(9), bps: 3000 }, { gauge: g(7), bps: 1000 }] },
      ],
    });
    expect(steps).toHaveLength(1);
    const [, chains, gauges] = steps[0].args;
    expect(chains.map((c) => [c.chainId, c.delta])).toEqual([[1n, 400n * E], [8453n, 600n * E]]);
    expect(chains[0]).toMatchObject({ gasLimit: CHAIN_STEP_GAS, value: 1000n });
    expect(chains[1]).toMatchObject({ gasLimit: 0n, value: 0n });
    expect(gauges.map((d) => d.chainId)).toEqual([1n, 8453n]);
    expect(gauges[0]).toMatchObject({ gasLimit: gaugeStepGas(2), value: 10_002n });
    expect(gauges[0].gauges.map((x) => [x.gauge, x.allocated])).toEqual([[g(7), 100n * E], [g(9), 300n * E]]);
    expect(steps[0].valueWei).toBe(1000n + 10_002n);
    // every gauge list adds up to its chain's whole budget
    for (const [i, d] of gauges.entries()) expect(d.gauges.reduce((s, x) => s + x.allocated, 0n)).toBe(chains[i].delta);
  });

  it("needs a return to idle first when Base's share goes down, then sends the rest", () => {
    const steps = plan({
      onBase: 1000n * E,
      targets: [
        { chainId: 8453, picks: [{ gauge: g(5), bps: 7000 }] },
        { chainId: 10, picks: [{ gauge: g(8), bps: 3000 }] },
      ],
    });
    expect(steps).toHaveLength(2);
    const [, c1, g1] = steps[0].args;
    expect(c1).toEqual([]);
    expect(g1).toHaveLength(1);
    expect(g1[0]).toMatchObject({ chainId: 8453n, gasLimit: 0n, value: 0n });
    const list = g1[0].gauges;
    expect(list.reduce((s, x) => s + x.allocated, 0n)).toBe(1000n * E);
    expect(list.find((x) => x.gauge === DEALLOC_GAUGE)?.allocated).toBe(300n * E);
    expect(list.find((x) => x.gauge === g(5))?.allocated).toBe(700n * E);
    expect(steps[0].valueWei).toBe(0n);
    // step 2 does not touch Base again (its wait would still be running) and only draws the returned power
    const [, c2, g2] = steps[1].args;
    expect(c2.map((c) => [c.chainId, c.delta])).toEqual([[10n, 300n * E]]);
    expect(g2.map((d) => d.chainId)).toEqual([10n]);
  });

  it("returns everything to idle with the lone marker when Base is left entirely", () => {
    const steps = plan({ onBase: 500n * E, targets: [{ chainId: 42161, picks: [{ gauge: g(3), bps: 10_000 }] }] });
    expect(steps[0].args[2][0].gauges).toEqual([{ gauge: DEALLOC_GAUGE, allocated: 500n * E, data: "0x" }]);
    expect(steps[1].args[1].map((c) => c.chainId)).toEqual([42161n]);
  });

  it("keeps Base's gauges untouched when they already match and only idle power is sent out (resume after step 1)", () => {
    const steps = plan({
      parked: 300n * E,
      onBase: 700n * E,
      currentBase: [{ gauge: g(5), pct: 100 }],
      targets: [
        { chainId: 8453, picks: [{ gauge: g(5), bps: 7000 }] },
        { chainId: 10, picks: [{ gauge: g(8), bps: 3000 }] },
      ],
    });
    expect(steps).toHaveLength(1);
    expect(steps[0].args[2].map((d) => d.chainId)).toEqual([10n]);
    expect(steps[0].args[1].map((c) => c.chainId)).toEqual([10n]);
  });

  it("encodes into a call the Voter ABI decodes back to the same arguments", () => {
    const [step] = plan({ parked: 10n * E, targets: [{ chainId: 8453, picks: [{ gauge: g(5), bps: 5000 }, { gauge: g(6), bps: 5000 }] }] });
    const data = encodeFunctionData({ abi: allocateAbi, functionName: "allocate", args: step.args });
    expect(decodeFunctionData({ abi: allocateAbi, data }).args).toEqual(step.args);
  });

  it("refuses plans the Voter would reject", () => {
    const t = (bps: number) => [{ chainId: 8453, picks: [{ gauge: g(5), bps }] }];
    expect(() => plan({ parked: 1n * E, targets: t(9000) })).toThrow(AllocateError);
    expect(() => plan({ targets: t(10_000) })).toThrow(/no power/);
    expect(() => plan({ parked: 1n * E, targets: [...t(5000), ...t(5000)] })).toThrow(/once/);
    expect(() => plan({ parked: 1n * E, targets: [{ chainId: 8453, picks: [{ gauge: g(5), bps: 5000 }, { gauge: g(5), bps: 5000 }] }] })).toThrow(/once/);
    expect(() => plan({ parked: 5n, targets: [{ chainId: 8453, picks: [{ gauge: g(5), bps: 9999 }, { gauge: g(6), bps: 1 }] }] })).toThrow(/too small/);
    expect(() => plan({ parked: 1n * E, targets: [{ chainId: 8453, picks: [{ gauge: "nope", bps: 10_000 }] }] })).toThrow(/gauge address/);
  });

  it("says so when the position already matches the split", () => {
    expect(() => plan({ onBase: 1000n * E, currentBase: [{ gauge: g(5), pct: 100 }], targets: [{ chainId: 8453, picks: [{ gauge: g(5), bps: 10_000 }] }] })).toThrow(/already matches/);
  });
});

describe("withMargin", () => {
  it("adds ten percent", () => expect(withMargin(parseEther("1"))).toBe(parseEther("1.1")));
});
