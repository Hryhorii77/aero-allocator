import { getAddress, isAddress, type Address } from "viem";
import { AllocateError, DEALLOC_GAUGE, MAX_GAUGES } from "./allocate";
import type { AllocateStep } from "./allocate-multichain";
import { gaugeStepGas } from "./allocate-fee";
import { SAERO_CHAIN_ID } from "./saero";

// Changing power that already sits on another chain (Dromos-Labs/metadex-public V3/src, Voter.sol, RootMessageOrchestrator.sol, read 2026-10-28):
//  - A gauge dispatch to a chain is a full overwrite of that chain's gauge list and must add up to the chain's whole budget.
//  - A list that carries the DEALLOC marker returns that amount to idle. The root orchestrator then keeps the chain's `deallocationReturnCost`
//    out of the dispatch's value (the leaf fronts the gas of the message back), so such a dispatch must carry at least that cost on top of the
//    outbound fee, or it reverts InsufficientDeallocationReturnCost.
//  - The idle power only reappears on Base when the leaf's return message arrives (Voter.processDeallocation), minutes later, unlike Base itself
//    where it is instant. So a return and a re-send are always separate transactions with a wait between them.
//  - The leaf's own wait (CooldownActive) applies to these messages too; the transport holds a message until it ends, so the caller checks the wait first.

const BPS = 10_000n;

export interface ManageFees {
  /** Wei for the outbound message of a gauge step with this many gauges (quote plus the caller's margin). */
  gaugeStepWei: (gauges: number) => bigint;
  /** Wei the chain keeps for the message back (from `deallocationReturnCost`; exact, no margin). */
  returnCostWei: bigint;
}

/** Takes all of a chain's power back to idle: the whole budget listed against the marker. */
export function planChainReturn(args: { tokenId: bigint; chainId: number; amount: bigint; fees: ManageFees; refundRecipient: Address }): AllocateStep {
  const { tokenId, chainId, amount, fees, refundRecipient } = args;
  if (chainId === SAERO_CHAIN_ID) throw new AllocateError("Base returns to idle with the Base button.");
  if (amount <= 0n) throw new AllocateError("Nothing of this position is on that chain.");
  const value = fees.gaugeStepWei(1) + fees.returnCostWei;
  return {
    label: "Return this chain's power to idle (it comes back to Base in a few minutes)",
    args: [tokenId, [], [{ chainId: BigInt(chainId), gasLimit: gaugeStepGas(1), value, gauges: [{ gauge: DEALLOC_GAUGE, allocated: amount, data: "0x" }] }], refundRecipient],
    valueWei: value,
    chains: [chainId],
    needsIdle: 0n,
    returns: true,
  };
}

/** Re-sets a chain's gauges to `picks` (shares of the chain's current power, in basis points adding up to 10,000). */
export function planChainRegauge(args: {
  tokenId: bigint;
  chainId: number;
  amount: bigint;
  picks: Array<{ gauge: string; bps: number }>;
  fees: ManageFees;
  refundRecipient: Address;
}): AllocateStep {
  const { tokenId, chainId, amount, picks, fees, refundRecipient } = args;
  if (chainId === SAERO_CHAIN_ID) throw new AllocateError("Base gauges are set with the allocate button.");
  if (amount <= 0n) throw new AllocateError("Nothing of this position is on that chain.");
  if (picks.length === 0) throw new AllocateError("Pick at least one gauge.");
  if (picks.length > MAX_GAUGES) throw new AllocateError(`At most ${MAX_GAUGES} gauges per chain.`);
  const seen = new Set<string>();
  let bpsSum = 0;
  for (const p of picks) {
    if (!isAddress(p.gauge)) throw new AllocateError("Not a gauge address.");
    const a = getAddress(p.gauge);
    if (seen.has(a)) throw new AllocateError("Each gauge can be picked once.");
    seen.add(a);
    if (!Number.isInteger(p.bps) || p.bps <= 0) throw new AllocateError("Each share must be at least 0.01%.");
    bpsSum += p.bps;
  }
  if (BigInt(bpsSum) !== BPS) throw new AllocateError("The shares must add up to exactly 100%.");
  const parts = picks.map((p) => ({ gauge: getAddress(p.gauge), bps: BigInt(p.bps), allocated: (amount * BigInt(p.bps)) / BPS }));
  const largest = parts.reduce((m, p) => (p.bps > m.bps ? p : m), parts[0]);
  largest.allocated += amount - parts.reduce((s, p) => s + p.allocated, 0n);
  if (parts.some((p) => p.allocated === 0n)) throw new AllocateError("A share is too small to hold any power.");
  const gauges = parts.map(({ gauge, allocated }) => ({ gauge, allocated, data: "0x" as const })).sort((a, b) => (BigInt(a.gauge) < BigInt(b.gauge) ? -1 : 1));
  const value = fees.gaugeStepWei(gauges.length);
  return {
    label: "Set this chain's gauges",
    args: [tokenId, [], [{ chainId: BigInt(chainId), gasLimit: gaugeStepGas(gauges.length), value, gauges }], refundRecipient],
    valueWei: value,
    chains: [chainId],
    needsIdle: 0n,
    returns: false,
  };
}
