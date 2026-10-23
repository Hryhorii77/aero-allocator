import { encodeFunctionData, getAddress, isAddress, type Address } from "viem";
import { SAERO, SAERO_CHAIN_ID } from "./saero";

// Builds Voter.allocate(...) for a position on Base (Aero's root chain), from Dromos-Labs/metadex-public V3/src
// (Voter.sol, AllocationLogicLibrary.sol, LeafAllocationLibrary.sol), read 2026-10-23. How it works:
//  - Power starts "parked" on CHAIN0 (id 0). A ChainAllocationDispatch moves `delta` of it onto a chain; delta is
//    additive and drawn only from the parked amount. Base is the root chain, so gasLimit and value are 0.
//  - A GaugeAllocationDispatch then spreads the chain's WHOLE budget over gauges: a full overwrite, absolute AERO
//    amounts summing exactly to the chain's total, strictly ascending by address, no zero amounts. Idle power must be
//    an explicit entry for address(0) (the first, lowest address). Gauges left out are cleared.
//  - At most `maxGauges` entries (20 at launch); the leaf enforces a 47 h cooldown between gauge allocations.
//  - Nothing is sent as ETH for the root chain: msg.value must equal the sum of dispatch values, all 0 here.

export const ZERO_GAUGE: Address = "0x0000000000000000000000000000000000000000";
export const MAX_GAUGES = 20;

export const allocateAbi = [
  {
    type: "function",
    name: "allocate",
    stateMutability: "payable",
    inputs: [
      { name: "_tokenId", type: "uint256" },
      {
        name: "_chainDispatches",
        type: "tuple[]",
        components: [
          { name: "chainId", type: "uint256" },
          { name: "delta", type: "uint128" },
          { name: "gasLimit", type: "uint256" },
          { name: "value", type: "uint256" },
        ],
      },
      {
        name: "_gaugeDispatches",
        type: "tuple[]",
        components: [
          { name: "chainId", type: "uint256" },
          { name: "gasLimit", type: "uint256" },
          { name: "value", type: "uint256" },
          {
            name: "gauges",
            type: "tuple[]",
            components: [
              { name: "gauge", type: "address" },
              { name: "allocated", type: "uint128" },
              { name: "data", type: "bytes" },
            ],
          },
        ],
      },
      { name: "_refundRecipient", type: "address" },
    ],
    outputs: [],
  },
] as const;

export interface GaugePick {
  gauge: Address;
  /** Share of the position's Base allocation, in percent (0-100]. */
  pct: number;
}

export interface AllocatePlan {
  tokenId: bigint;
  /** Power moved from CHAIN0 onto Base by this call. */
  delta: bigint;
  /** The Base budget after the call (already on Base + delta). */
  chainTotal: bigint;
  /** Entries of the gauge list in the order sent, amounts in base units. */
  gauges: Array<{ gauge: Address; allocated: bigint }>;
  /** Idle power kept on Base without a gauge (ZERO_GAUGE entry), base units. */
  idle: bigint;
}

export class AllocateError extends Error {}

const BPS = 10_000n;

/**
 * Splits `total` over the picks by percentage (basis-point precision), the rounding remainder going to the largest
 * pick so the sum is exact. Any share below 100% in total is kept idle.
 */
export function planAllocation(args: { tokenId: bigint; parked: bigint; onBase: bigint; picks: GaugePick[] }): AllocatePlan {
  const { tokenId, parked, onBase, picks } = args;
  const chainTotal = parked + onBase;
  if (chainTotal <= 0n) throw new AllocateError("This position has no power available on Base.");
  if (picks.length === 0) throw new AllocateError("Pick at least one gauge.");
  if (picks.length > MAX_GAUGES) throw new AllocateError(`At most ${MAX_GAUGES} gauges per position.`);

  const seen = new Set<string>();
  const parts = picks.map((p) => {
    if (!isAddress(p.gauge)) throw new AllocateError("Not a gauge address.");
    const gauge = getAddress(p.gauge);
    if (gauge === ZERO_GAUGE) throw new AllocateError("Not a gauge address.");
    if (seen.has(gauge)) throw new AllocateError("Each gauge can be picked once.");
    seen.add(gauge);
    if (!(p.pct > 0)) throw new AllocateError("Each share must be above 0%.");
    return { gauge, bps: BigInt(Math.round(p.pct * 100)) };
  });
  const bpsTotal = parts.reduce((a, p) => a + p.bps, 0n);
  if (bpsTotal > BPS) throw new AllocateError("Shares add up to more than 100%.");
  if (parts.some((p) => p.bps === 0n)) throw new AllocateError("Each share must be at least 0.01%.");

  const amounts = parts.map((p) => ({ gauge: p.gauge, bps: p.bps, allocated: (chainTotal * p.bps) / BPS }));
  const wanted = (chainTotal * bpsTotal) / BPS;
  const assigned = amounts.reduce((a, p) => a + p.allocated, 0n);
  const largest = amounts.reduce((m, p) => (p.bps > m.bps ? p : m), amounts[0]);
  largest.allocated += wanted - assigned;
  if (amounts.some((p) => p.allocated === 0n)) throw new AllocateError("A share is too small to hold any power.");

  const idle = chainTotal - wanted;
  const sorted = amounts.map((p) => ({ gauge: p.gauge, allocated: p.allocated })).sort((a, b) => (BigInt(a.gauge) < BigInt(b.gauge) ? -1 : 1));
  const gauges = idle > 0n ? [{ gauge: ZERO_GAUGE, allocated: idle }, ...sorted] : sorted;
  if (gauges.length > MAX_GAUGES) throw new AllocateError(`At most ${MAX_GAUGES} entries including idle power.`);
  return { tokenId, delta: parked, chainTotal, gauges, idle };
}

/** The `allocate` arguments for a plan, Base only (no ETH). */
export function allocateArgs(plan: AllocatePlan, refundRecipient: Address) {
  const chainDispatches =
    plan.delta > 0n ? [{ chainId: BigInt(SAERO_CHAIN_ID), delta: plan.delta, gasLimit: 0n, value: 0n }] : [];
  const gaugeDispatches = [
    {
      chainId: BigInt(SAERO_CHAIN_ID),
      gasLimit: 0n,
      value: 0n,
      gauges: plan.gauges.map((g) => ({ gauge: g.gauge, allocated: g.allocated, data: "0x" as const })),
    },
  ];
  return [plan.tokenId, chainDispatches, gaugeDispatches, refundRecipient] as const;
}

export function encodeAllocate(plan: AllocatePlan, refundRecipient: Address) {
  return { to: SAERO.voter, data: encodeFunctionData({ abi: allocateAbi, functionName: "allocate", args: allocateArgs(plan, refundRecipient) }), value: 0n };
}
