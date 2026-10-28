import { describe, expect, it } from "vitest";
import { decodeFunctionData, encodeFunctionData, parseEther } from "viem";
import { allocateAbi, AllocateError, DEALLOC_GAUGE } from "./allocate";
import { CHAIN_STEP_GAS, gaugeStepGas } from "./allocate-fee";
import { planAcrossChains, withMargin, type CrossChainFees } from "./allocate-multichain";

const OWNER = "0x9b3F205E43dc9FcC1cc2Fe6d9dCD0357769A6Bae" as const;
const g = (n: number) => `0x${n.toString(16).padStart(40, "0")}` as const;
const E = 10n ** 18n;
const fees: CrossChainFees = { chainStepWei: (c) => BigInt(c) * 1_000n, gaugeStepWei: (c, n) => BigInt(c) * 10_000n + BigInt(n), returnCostWei: (c) => BigInt(c) * 7n };
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

describe("planAcrossChains from a position that already has power on other chains", () => {
  const arc = (amount: bigint, gauge = g(7)) => ({ 5042: { amount, gauges: [{ gauge, pct: 100 }] } });
  it("partial return: Arc goes from 60% to 30%, the rest is returned and then sent on to Base", () => {
    const steps = plan({ onBase: 400n * E, others: arc(600n * E), currentBase: [{ gauge: g(5), pct: 100 }],
      targets: [{ chainId: 8453, picks: [{ gauge: g(5), bps: 7000 }] }, { chainId: 5042, picks: [{ gauge: g(7), bps: 3000 }] }] });
    expect(steps.map((s) => [s.returns, s.chains])).toEqual([[true, [5042]], [false, [8453]]]);
    const d = steps[0].args[2][0];
    expect(d).toMatchObject({ chainId: 5042n, gasLimit: gaugeStepGas(2) });
    expect(d.value).toBe(5042n * 10_000n + 2n + 5042n * 7n); // outbound fee for 2 entries + the chain's return cost
    expect(d.gauges.find((x) => x.gauge === DEALLOC_GAUGE)?.allocated).toBe(300n * E);
    expect(d.gauges.find((x) => x.gauge === g(7))?.allocated).toBe(300n * E);
    expect(steps[0].needsIdle).toBe(0n);
    // the main step draws the 300 that comes back, for Base's increase (Base is instant: no value, no gas limit)
    expect(steps[1].needsIdle).toBe(300n * E);
    expect(steps[1].args[1]).toEqual([{ chainId: 8453n, delta: 300n * E, gasLimit: 0n, value: 0n }]);
  });
  it("a direct move between chains is a return first and a send once the idle power is there", () => {
    const steps = plan({ onBase: 0n, others: { 10: { amount: 400n * E, gauges: [{ gauge: g(3), pct: 100 }] } }, currentBase: [],
      targets: [{ chainId: 5042, picks: [{ gauge: g(7), bps: 10_000 }] }] });
    expect(steps).toHaveLength(2);
    expect(steps[0].args[2][0].gauges).toEqual([{ gauge: DEALLOC_GAUGE, allocated: 400n * E, data: "0x" }]);
    expect(steps[0].chains).toEqual([10]);
    expect(steps[1].chains).toEqual([5042]);
    expect(steps[1].needsIdle).toBe(400n * E);
  });
  it("once the return has arrived (idle power is there) only the send remains", () => {
    const steps = plan({ parked: 400n * E, onBase: 0n, others: {}, currentBase: [], targets: [{ chainId: 5042, picks: [{ gauge: g(7), bps: 10_000 }] }] });
    expect(steps).toHaveLength(1);
    expect(steps[0].returns).toBe(false);
    expect(steps[0].needsIdle).toBe(400n * E);
  });
  it("a mixed position (idle on Base plus power on Arc) adds a chain without touching the one it keeps", () => {
    const steps = plan({ parked: 300n * E, others: arc(700n * E), currentBase: [],
      targets: [{ chainId: 5042, picks: [{ gauge: g(7), bps: 7000 }] }, { chainId: 10, picks: [{ gauge: g(3), bps: 3000 }] }] });
    expect(steps).toHaveLength(1);
    expect(steps[0].args[1].map((c) => c.chainId)).toEqual([10n]);
    expect(steps[0].args[2].map((d) => d.chainId)).toEqual([10n]);
    expect(steps[0].chains).toEqual([10]);
  });
  it("re-sets a chain's gauges without moving power when the amount is the same but the gauges differ", () => {
    const steps = plan({ others: arc(1000n * E, g(7)), targets: [{ chainId: 5042, picks: [{ gauge: g(8), bps: 10_000 }] }] });
    expect(steps).toHaveLength(1);
    expect(steps[0].args[1]).toEqual([]);
    expect(steps[0].args[2][0].gauges[0]).toMatchObject({ gauge: g(8), allocated: 1000n * E });
    expect(steps[0].needsIdle).toBe(0n);
    expect(() => plan({ others: arc(1000n * E, g(7)), targets: [{ chainId: 5042, picks: [{ gauge: g(7), bps: 10_000 }] }] })).toThrow(/already matches/);
  });
  it("returns everything from several chains in one transaction", () => {
    const steps = plan({ onBase: 500n * E, others: { 10: { amount: 200n * E, gauges: [{ gauge: g(3), pct: 100 }] }, 5042: { amount: 300n * E, gauges: [{ gauge: g(7), pct: 100 }] } }, currentBase: [{ gauge: g(5), pct: 100 }],
      targets: [{ chainId: 8453, picks: [{ gauge: g(5), bps: 10_000 }] }] });
    expect(steps[0].chains).toEqual([10, 5042]);
    expect(steps[0].args[2].map((d) => d.chainId)).toEqual([10n, 5042n]);
    expect(steps[1].args[1].map((c) => [c.chainId, c.delta])).toEqual([[8453n, 500n * E]]);
    expect(steps[1].needsIdle).toBe(500n * E);
  });
});

describe("planAcrossChains rounding", () => {
  it("does not send power for a difference of a few wei, and keeps an updated chain's list at its real budget", () => {
    // Arc holds 3 wei more than the target says; only its gauges differ, so it is re-set over the budget it really has.
    const steps = plan({ parked: 0n, others: { 5042: { amount: 1000n * E + 3n, gauges: [{ gauge: g(7), pct: 100 }] } }, currentBase: [], targets: [{ chainId: 5042, picks: [{ gauge: g(8), bps: 10_000 }] }] });
    expect(steps).toHaveLength(1);
    expect(steps[0].args[1]).toEqual([]);
    expect(steps[0].args[2][0].gauges.reduce((a, x) => a + x.allocated, 0n)).toBe(1000n * E + 3n);
    // and when the gauges already match, a few wei is not a reason to do anything
    expect(() => plan({ others: { 5042: { amount: 1000n * E + 3n, gauges: [{ gauge: g(7), pct: 100 }] } }, currentBase: [], targets: [{ chainId: 5042, picks: [{ gauge: g(7), bps: 10_000 }] }] })).toThrow(/already matches/);
  });
});

describe("withMargin", () => {
  it("adds ten percent", () => expect(withMargin(parseEther("1"))).toBe(parseEther("1.1")));
});
