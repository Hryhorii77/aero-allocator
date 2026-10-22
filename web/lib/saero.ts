// Aero (the merged Aerodrome/Velodrome) went live on 2026-10-22 00:00 UTC. These are the Base contracts
// Dromos Labs published in github.com/Dromos-Labs/metadex-public (deployment-addresses/root-base.json,
// leaf-base.json), checked to have code on Base on 2026-10-22. They are the NEW system; the old Voter that
// /api/protocol returns only serves the retired weekly vote.

export const SAERO_CHAIN_ID = 8453;

export const SAERO = {
  votingEscrow: "0xBF7977E1521e9a3032bf7243Ee4712f311f13915",
  voter: "0x49d7d4f17Ec56Ef8fA04E464AF5D1A4942CC31e6",
  leafVoter: "0x382409fad8503FbCdbB27A4211551fa03e884078",
} as const;

export const saeroEscrowAbi = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "owner", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "tokenOfOwnerByIndex", stateMutability: "view", inputs: [{ name: "owner", type: "address" }, { name: "index", type: "uint256" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "balanceOfNFT", stateMutability: "view", inputs: [{ name: "tokenId", type: "uint256" }], outputs: [{ type: "uint256" }] },
  {
    type: "function",
    name: "staked",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "amount", type: "uint128" },
          { name: "end", type: "uint48" },
          { name: "isPermanent", type: "bool" },
        ],
      },
    ],
  },
] as const;

export const saeroVoterAbi = [
  {
    type: "function",
    name: "tokenStates",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [
      { name: "committed", type: "uint128" },
      { name: "lastStakeEnd", type: "uint48" },
      { name: "lastAllocated", type: "uint48" },
      { name: "isPermanent", type: "bool" },
    ],
  },
] as const;

export const saeroLeafAbi = [
  { type: "function", name: "allocationCooldown", stateMutability: "view", inputs: [], outputs: [{ type: "uint48" }] },
] as const;

/** The cooldown Aero set at launch (47 hours), used until the live value is read. */
export const DEFAULT_COOLDOWN_SEC = 169_200;

export interface SaeroPosition {
  tokenId: bigint;
  /** Staked AERO, in whole tokens. */
  staked: number;
  /** Current voting power, in whole tokens. */
  votingPower: number;
  /** Lock end as unix seconds; 0 for a permanent stake. */
  endSec: number;
  isPermanent: boolean;
  /** Amount currently allocated, in whole tokens. */
  committed: number;
  /** Unix seconds of the last allocation, 0 if never allocated. */
  lastAllocatedSec: number;
}

export type CooldownState = { ready: true } | { ready: false; secondsLeft: number; readyAtSec: number };

/** A position can be re-allocated once `cooldownSec` has passed since its last allocation. */
export function cooldownState(lastAllocatedSec: number, cooldownSec: number, nowSec: number): CooldownState {
  if (lastAllocatedSec <= 0) return { ready: true };
  const readyAtSec = lastAllocatedSec + cooldownSec;
  return nowSec >= readyAtSec ? { ready: true } : { ready: false, secondsLeft: readyAtSec - nowSec, readyAtSec };
}

/** "46h 12m", "3h 05m", "12m"; never negative. */
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  return `${m}m`;
}

/** Shares of a position's power that are allocated; 0 when it has none. */
export function allocatedPct(p: Pick<SaeroPosition, "committed" | "staked">): number {
  return p.staked > 0 ? Math.min(100, (p.committed / p.staked) * 100) : 0;
}
