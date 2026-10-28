import { getAddress, isAddress, type Address } from "viem";
import { AllocateError, DEALLOC_GAUGE, MAX_GAUGES } from "./allocate";
import { CHAIN_STEP_GAS, gaugeStepGas } from "./allocate-fee";
import { SAERO_CHAIN_ID } from "./saero";

// Builds the Voter.allocate(...) calls that spread a position over gauges on several Aero chains (Dromos-Labs/metadex-public V3/src,
// Voter.sol `allocate` and AllocationLogicLibrary.sol, read 2026-10-28). What shapes the plan:
//  - One allocate() runs every chain dispatch first, then every gauge dispatch. A chain dispatch can only draw power that is already
//    parked (idle), so power that sits on Base's gauges cannot be moved to another chain in the same call: it is first returned to idle
//    (a Base gauge list with the DEALLOC marker, free on the root chain) and then sent. That makes two transactions when the Base
//    share is going down, one when it is not.
//  - msg.value must equal the sum of every dispatch's `value` exactly; a dispatch to another chain needs a non-zero destination gas limit.
//  - Gauge lists and the dispatch lists are strictly ascending (by address, by chain id) and carry no zero amounts; a chain's gauge list
//    must add up to that chain's whole budget.
//  - The plan starts from where the position is now on EVERY chain, not only Base. A chain whose share goes down keeps the gauges it still
//    wants and lists the rest against the DEALLOC marker (a partial return); a chain whose share goes up draws idle power. Power returned from a
//    chain other than Base only becomes idle on Base when the leaf's message arrives (minutes), and the marker needs that chain's return cost on
//    top of the message fee (RootMessageOrchestrator.sol), so the plan is up to two steps and the second reports how much idle power it needs.

export interface ChainTarget {
  chainId: number;
  /** Gauges on this chain, each as a share of the WHOLE position in basis points (all picks of all chains add up to 10,000). */
  picks: Array<{ gauge: string; bps: number }>;
}

/** ETH (wei) to attach to each cross-chain message; the caller adds its safety margin. */
export interface CrossChainFees {
  chainStepWei: (chainId: number) => bigint;
  gaugeStepWei: (chainId: number, gauges: number) => bigint;
  /** What a chain keeps out of a dispatch that returns power (its `deallocationReturnCost`); 0 for Base. */
  returnCostWei?: (chainId: number) => bigint;
}

export type ChainDispatch = { chainId: bigint; delta: bigint; gasLimit: bigint; value: bigint };
export type GaugeDispatch = { chainId: bigint; gasLimit: bigint; value: bigint; gauges: Array<{ gauge: Address; allocated: bigint; data: "0x" }> };

export interface AllocateStep {
  /** What this transaction does, in plain words. */
  label: string;
  args: readonly [bigint, ChainDispatch[], GaugeDispatch[], Address];
  /** msg.value: the sum of every dispatch's value. */
  valueWei: bigint;
  /** Every chain this transaction sets gauges on (each chain's own wait applies to it). */
  chains: number[];
  /** Idle power this step draws, base units: it can only be sent once the position's idle power is at least this much. */
  needsIdle: bigint;
  /** True for the step that returns power to idle. */
  returns: boolean;
}

/** Where the position sits on a chain now: its budget there and the gauges it is on. */
export interface CurrentChain {
  amount: bigint;
  gauges: Array<{ gauge: string; pct: number }>;
}

const BPS = 10_000n;
const BASE = BigInt(SAERO_CHAIN_ID);
const byAddress = (a: { gauge: Address }, b: { gauge: Address }) => (BigInt(a.gauge) < BigInt(b.gauge) ? -1 : 1);

/** Safety margin on a quoted cross-chain fee: gas prices move between the quote and the block, and unused ETH is refunded to the owner. */
export const FEE_MARGIN_PCT = 10n;
export const withMargin = (wei: bigint) => (wei * (100n + FEE_MARGIN_PCT)) / 100n;

/** Whether the current gauges already are the target ones (same gauges, shares within half a percent of the chain's amount). */
function sameGauges(current: Array<{ gauge: string; pct: number }>, picks: Array<{ gauge: string; bps: number }>, chainBps: number): boolean {
  if (current.length !== picks.length || chainBps <= 0) return false;
  const now = new Map(current.map((c) => [c.gauge.toLowerCase(), c.pct]));
  return picks.every((p) => {
    const have = now.get(p.gauge.toLowerCase());
    return have !== undefined && Math.abs(have - (p.bps / chainBps) * 100) < 0.5;
  });
}

/**
 * The transactions that take a position from where it is (`parked` idle, `onBase` on Base's gauges, `others` on other chains) to
 * `targets`. Steps are meant to be sent in order, the next only after the previous is confirmed, and the main step only once the idle power
 * it needs (`needsIdle`) has arrived. Throws AllocateError for anything the Voter would reject, so a bad plan never reaches the wallet.
 */
export function planAcrossChains(args: {
  tokenId: bigint;
  parked: bigint;
  onBase: bigint;
  targets: ChainTarget[];
  fees: CrossChainFees;
  /** The position's current Base gauges (for skipping a Base re-allocation that would change nothing). */
  currentBase: Array<{ gauge: string; pct: number }>;
  /** Where the position sits on other chains now, by chain id. */
  others?: Record<number, CurrentChain>;
  refundRecipient: Address;
}): AllocateStep[] {
  const { tokenId, parked, onBase, targets, fees, currentBase, refundRecipient } = args;
  const others = args.others ?? {};
  const now = new Map<number, CurrentChain>([[SAERO_CHAIN_ID, { amount: onBase, gauges: currentBase }]]);
  for (const [id, c] of Object.entries(others)) if (c.amount > 0n) now.set(Number(id), c);
  const total = parked + [...now.values()].reduce((s, c) => s + c.amount, 0n);
  if (total <= 0n) throw new AllocateError("This position has no power to allocate.");

  const seenChains = new Set<number>();
  const seenGauges = new Set<string>();
  let bpsSum = 0;
  for (const t of targets) {
    if (seenChains.has(t.chainId)) throw new AllocateError("Each chain can be listed once.");
    seenChains.add(t.chainId);
    if (t.picks.length === 0) throw new AllocateError("A chain needs at least one gauge.");
    for (const p of t.picks) {
      if (!isAddress(p.gauge)) throw new AllocateError("Not a gauge address.");
      const k = `${t.chainId}:${getAddress(p.gauge)}`;
      if (seenGauges.has(k)) throw new AllocateError("Each gauge can be picked once.");
      seenGauges.add(k);
      if (!Number.isInteger(p.bps) || p.bps <= 0) throw new AllocateError("Each share must be at least 0.01%.");
      bpsSum += p.bps;
    }
    if (t.picks.length > MAX_GAUGES) throw new AllocateError(`At most ${MAX_GAUGES} gauges per chain.`);
  }
  if (bpsSum !== Number(BPS)) throw new AllocateError("The shares must add up to exactly 100%.");

  // Amounts: each gauge's basis points of the whole, the rounding remainder going to the largest gauge.
  const flat = targets.flatMap((t) => t.picks.map((p) => ({ chainId: t.chainId, gauge: getAddress(p.gauge), bps: BigInt(p.bps), allocated: (total * BigInt(p.bps)) / BPS })));
  const remainder = total - flat.reduce((s, p) => s + p.allocated, 0n);
  const largest = flat.reduce((m, p) => (p.bps > m.bps ? p : m), flat[0]);
  largest.allocated += remainder;
  if (flat.some((p) => p.allocated === 0n)) throw new AllocateError("A share is too small to hold any power.");

  const onChain = (id: number) => flat.filter((p) => p.chainId === id);
  const chainTotal = (id: number) => onChain(id).reduce((s, p) => s + p.allocated, 0n);
  const toGauges = (ps: Array<{ gauge: Address; allocated: bigint }>) => ps.map(({ gauge, allocated }) => ({ gauge, allocated, data: "0x" as const })).sort(byAddress);
  const returnCost = (id: number) => (id === SAERO_CHAIN_ID ? 0n : (fees.returnCostWei?.(id) ?? 0n));

  // Differences this small are rounding (a stake that moved by a few wei, a share rounded in basis points): not worth a message, and a chain's gauge
  // list must add up to its real budget anyway, so such a chain keeps its amount and only its gauges can change.
  const dust = total / 1_000_000_000n + 1_000n;
  const absDiff = (a: bigint, b: bigint) => (a > b ? a - b : b - a);

  // What each chain needs: a return (its share goes down), idle power (it goes up), or just new gauges (same amount, different gauges).
  const ids = [...new Set([...now.keys(), ...targets.map((t) => t.chainId)])].sort((a, b) => a - b);
  const returns: Array<{ id: number; amount: bigint }> = [];
  const sends: Array<{ id: number; delta: bigint }> = [];
  const updates: number[] = [];
  for (const id of ids) {
    const have = now.get(id)?.amount ?? 0n;
    const want = chainTotal(id);
    if (absDiff(want, have) > dust && want < have) returns.push({ id, amount: have - want });
    else if (absDiff(want, have) > dust && want > have) sends.push({ id, delta: want - have });
    else if (want > 0n && have > 0n) {
      const tBps = Math.round(Number((want * BPS) / total));
      const picks = targets.find((t) => t.chainId === id)?.picks ?? [];
      if (!sameGauges(now.get(id)?.gauges ?? [], picks, tBps)) updates.push(id);
    }
  }

  const steps: AllocateStep[] = [];

  // Step 1, only when a chain's share goes down: each such chain keeps the gauges it still wants and returns the rest to idle. Base is instant;
  // another chain's return arrives later and costs its return fee on top of the message.
  if (returns.length > 0) {
    const gaugeDispatches: GaugeDispatch[] = returns.map(({ id, amount }) => {
      const kept = onChain(id).map((p) => ({ gauge: p.gauge, allocated: p.allocated }));
      const entries = [...kept, { gauge: DEALLOC_GAUGE, allocated: amount }];
      if (entries.length > MAX_GAUGES) throw new AllocateError(`At most ${MAX_GAUGES} entries on one chain.`);
      return id === SAERO_CHAIN_ID
        ? { chainId: BASE, gasLimit: 0n, value: 0n, gauges: toGauges(entries) }
        : { chainId: BigInt(id), gasLimit: gaugeStepGas(entries.length), value: fees.gaugeStepWei(id, entries.length) + returnCost(id), gauges: toGauges(entries) };
    });
    const onlyBase = returns.length === 1 && returns[0].id === SAERO_CHAIN_ID;
    const keepsSome = returns.some((r) => chainTotal(r.id) > 0n);
    steps.push({
      label: onlyBase
        ? keepsSome
          ? "Move part of the Base allocation back to idle and set the Base gauges"
          : "Move the Base allocation back to idle"
        : returns.length === 1
          ? "Return power from one chain to idle (it reaches Base in a few minutes)"
          : `Return power from ${returns.length} chains to idle (it reaches Base in a few minutes)`,
      args: [tokenId, [], gaugeDispatches, refundRecipient],
      valueWei: gaugeDispatches.reduce((s, d) => s + d.value, 0n),
      chains: returns.map((r) => r.id),
      needsIdle: 0n,
      returns: true,
    });
  }

  // Main step: idle power goes out to the chains whose share goes up, then their gauges are set; chains with the same amount but other gauges are re-set too.
  const chainDispatches: ChainDispatch[] = [];
  const gaugeDispatches: GaugeDispatch[] = [];
  for (const { id, delta } of sends) {
    chainDispatches.push(id === SAERO_CHAIN_ID ? { chainId: BASE, delta, gasLimit: 0n, value: 0n } : { chainId: BigInt(id), delta, gasLimit: CHAIN_STEP_GAS, value: fees.chainStepWei(id) });
  }
  for (const id of [...sends.map((x) => x.id), ...updates].sort((a, b) => a - b)) {
    // A chain that only changes gauges keeps its real budget: the rounding difference goes to its largest gauge so the list adds up exactly.
    const picks = onChain(id).map((p) => ({ ...p }));
    if (updates.includes(id)) {
      const budget = now.get(id)?.amount ?? 0n;
      const top = picks.reduce((m, p) => (p.allocated > m.allocated ? p : m), picks[0]);
      top.allocated += budget - picks.reduce((sum, p) => sum + p.allocated, 0n);
    }
    gaugeDispatches.push(
      id === SAERO_CHAIN_ID
        ? { chainId: BASE, gasLimit: 0n, value: 0n, gauges: toGauges(picks) }
        : { chainId: BigInt(id), gasLimit: gaugeStepGas(picks.length), value: fees.gaugeStepWei(id, picks.length), gauges: toGauges(picks) },
    );
  }
  if (gaugeDispatches.length > 0 || chainDispatches.length > 0) {
    const valueWei = [...chainDispatches, ...gaugeDispatches].reduce((s, d) => s + d.value, 0n);
    const sentTo = sends.filter((x) => x.id !== SAERO_CHAIN_ID).length;
    steps.push({
      label: sentTo > 0 ? `Send power to ${sentTo === 1 ? "another chain" : `${sentTo} other chains`} and set its gauges` : sends.length > 0 || updates.length > 0 ? "Set the gauges" : "Set the Base gauges",
      args: [tokenId, chainDispatches, gaugeDispatches, refundRecipient],
      valueWei,
      chains: gaugeDispatches.map((d) => Number(d.chainId)),
      needsIdle: sends.reduce((s, x) => s + x.delta, 0n),
      returns: false,
    });
  }
  if (steps.length === 0) throw new AllocateError("This position already matches that split.");
  return steps;
}
