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
