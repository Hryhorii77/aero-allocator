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

export interface ChainTarget {
  chainId: number;
  /** Gauges on this chain, each as a share of the WHOLE position in basis points (all picks of all chains add up to 10,000). */
  picks: Array<{ gauge: string; bps: number }>;
}

/** ETH (wei) to attach to each cross-chain message; the caller adds its safety margin. */
export interface CrossChainFees {
  chainStepWei: (chainId: number) => bigint;
  gaugeStepWei: (chainId: number, gauges: number) => bigint;
}

export type ChainDispatch = { chainId: bigint; delta: bigint; gasLimit: bigint; value: bigint };
export type GaugeDispatch = { chainId: bigint; gasLimit: bigint; value: bigint; gauges: Array<{ gauge: Address; allocated: bigint; data: "0x" }> };

export interface AllocateStep {
  /** What this transaction does, in plain words. */
  label: string;
  args: readonly [bigint, ChainDispatch[], GaugeDispatch[], Address];
  /** msg.value: the sum of every dispatch's value. */
  valueWei: bigint;
}

const BPS = 10_000n;
const BASE = BigInt(SAERO_CHAIN_ID);
const byAddress = (a: { gauge: Address }, b: { gauge: Address }) => (BigInt(a.gauge) < BigInt(b.gauge) ? -1 : 1);

/** Safety margin on a quoted cross-chain fee: gas prices move between the quote and the block, and unused ETH is refunded to the owner. */
export const FEE_MARGIN_PCT = 10n;
export const withMargin = (wei: bigint) => (wei * (100n + FEE_MARGIN_PCT)) / 100n;

/** Whether the position's current Base gauges already are the target ones (same gauges, shares within half a percent of the position's Base amount). */
function sameBase(current: Array<{ gauge: string; pct: number }>, picks: Array<{ gauge: string; bps: number }>, tBps: number): boolean {
  if (current.length !== picks.length || tBps <= 0) return false;
  const now = new Map(current.map((c) => [c.gauge.toLowerCase(), c.pct]));
  return picks.every((p) => {
    const have = now.get(p.gauge.toLowerCase());
    return have !== undefined && Math.abs(have - (p.bps / tBps) * 100) < 0.5;
  });
}

/**
 * The transactions that take a position from where it is (`parked` idle, `onBase` on Base's gauges, nothing on other chains) to
 * `targets`. Steps are meant to be sent in order, the next only after the previous is confirmed. Throws AllocateError for anything the
 * Voter would reject, so a bad plan never reaches the wallet.
 */
export function planAcrossChains(args: {
  tokenId: bigint;
  parked: bigint;
  onBase: bigint;
  targets: ChainTarget[];
  fees: CrossChainFees;
  /** The position's current Base gauges (for skipping a Base re-allocation that would change nothing). */
  currentBase: Array<{ gauge: string; pct: number }>;
  refundRecipient: Address;
}): AllocateStep[] {
  const { tokenId, parked, onBase, targets, fees, currentBase, refundRecipient } = args;
  const total = parked + onBase;
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

  const tBase = chainTotal(SAERO_CHAIN_ID);
  const needReturn = onBase > tBase ? onBase - tBase : 0n;
  const steps: AllocateStep[] = [];

  // Step 1, only when Base's share goes down: Base's gauges keep their new share and the rest goes back to idle, in one Base-only call.
  if (needReturn > 0n) {
    const entries = [...onChain(SAERO_CHAIN_ID).map((p) => ({ gauge: p.gauge, allocated: p.allocated })), { gauge: DEALLOC_GAUGE, allocated: needReturn }];
    if (entries.length > MAX_GAUGES) throw new AllocateError(`At most ${MAX_GAUGES} entries on Base.`);
    steps.push({
      label: tBase > 0n ? "Move part of the Base allocation back to idle and set the Base gauges" : "Move the Base allocation back to idle",
      args: [tokenId, [], [{ chainId: BASE, gasLimit: 0n, value: 0n, gauges: toGauges(entries) }], refundRecipient],
      valueWei: 0n,
    });
  }

  // Main step: idle power goes out to the chains (Base included when its share goes up), then each chain's gauges are set.
  const others = targets.map((t) => t.chainId).filter((id) => id !== SAERO_CHAIN_ID).sort((a, b) => a - b);
  const baseDelta = needReturn === 0n && tBase > onBase ? tBase - onBase : 0n;
  const baseUnchanged = needReturn === 0n && baseDelta === 0n && sameBase(currentBase, targets.find((t) => t.chainId === SAERO_CHAIN_ID)?.picks ?? [], Math.round(Number((tBase * BPS) / total)));
  const touchBase = tBase > 0n && needReturn === 0n && !baseUnchanged;

  const chainDispatches: ChainDispatch[] = [];
  const gaugeDispatches: GaugeDispatch[] = [];
  const ids = [...others, ...(baseDelta > 0n ? [SAERO_CHAIN_ID] : [])].sort((a, b) => a - b);
  for (const id of ids) {
    if (id === SAERO_CHAIN_ID) chainDispatches.push({ chainId: BASE, delta: baseDelta, gasLimit: 0n, value: 0n });
    else chainDispatches.push({ chainId: BigInt(id), delta: chainTotal(id), gasLimit: CHAIN_STEP_GAS, value: fees.chainStepWei(id) });
  }
  for (const id of [...others, ...(touchBase ? [SAERO_CHAIN_ID] : [])].sort((a, b) => a - b)) {
    const picks = onChain(id);
    if (id === SAERO_CHAIN_ID) gaugeDispatches.push({ chainId: BASE, gasLimit: 0n, value: 0n, gauges: toGauges(picks) });
    else gaugeDispatches.push({ chainId: BigInt(id), gasLimit: gaugeStepGas(picks.length), value: fees.gaugeStepWei(id, picks.length), gauges: toGauges(picks) });
  }
  if (gaugeDispatches.length > 0 || chainDispatches.length > 0) {
    const valueWei = [...chainDispatches, ...gaugeDispatches].reduce((s, d) => s + d.value, 0n);
    const names = others.length > 0 ? `Send power to ${others.length === 1 ? "another chain" : `${others.length} other chains`} and set its gauges` : "Set the Base gauges";
    steps.push({ label: names, args: [tokenId, chainDispatches, gaugeDispatches, refundRecipient], valueWei });
  }
  if (steps.length === 0) throw new AllocateError("This position already matches that split.");
  return steps;
}
