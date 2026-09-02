import { parseAbi } from "viem";

// Contract addresses are NOT hardcoded here — see useProtocolAddresses in
// @/lib/protocol, which fetches them from /api/protocol (server-side
// PRESET, single source of truth) so the right protocol's addresses are
// always used, regardless of which deployment this is.

// Both Aerodrome and Velodrome share the same Sugar/ve(3,3) contract
// pattern (Aerodrome is a Velodrome fork), so these ABIs are protocol-agnostic.
export const voterAbi = parseAbi([
  "function vote(uint256 _tokenId, address[] _poolVote, uint256[] _weights)",
]);

// VeNFT struct from velodrome-finance/sugar contracts/VeSugar.vy. Used for
// auto-detecting the connected wallet's veAERO NFTs; callers must tolerate
// failure (deployed Sugar versions have diverged from source before).
export const veSugarAbi = parseAbi([
  "struct LpVotes { address lp; uint256 weight; }",
  "struct VeNFT { uint256 id; address account; uint8 decimals; uint128 amount; uint256 voting_amount; uint256 governance_amount; uint256 rebase_amount; uint256 expires_at; uint256 voted_at; LpVotes[] votes; address token; bool permanent; uint256 delegate_id; uint256 managed_id; }",
  "function byAccount(address _account) view returns (VeNFT[])",
]);

/**
 * Builds Voter.vote()'s args from an allocation: pool addresses and integer
 * weights. Voter.vote() takes arbitrary relative weights (it normalizes by
 * their sum onchain, not a fixed 0-100/0-10000 scale) — ×100 just keeps two
 * decimal places of a weightPct like 33.33 from being truncated to 33 by
 * the uint256 cast, which would otherwise silently throw away precision on
 * every vote. Exported (not inlined in wallet.tsx) so this correctness-
 * critical conversion — a bug here misallocates a real onchain vote — has
 * a direct unit test rather than only being exercised via a full wallet UI.
 */
export function buildVoteArgs(
  tokenId: string,
  allocations: Array<{ pool: string; weightPct: number }>,
) {
  return [
    BigInt(tokenId),
    allocations.map((a) => a.pool as `0x${string}`),
    allocations.map((a) => BigInt(Math.round(a.weightPct * 100))),
  ] as const;
}
