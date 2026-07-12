import { parseAbi } from "viem";

export const VOTER_ADDRESS = "0x16613524e02ad97eDfeF371bC883F2F5d6C480A5" as const;
export const VE_SUGAR_ADDRESS = "0x4d6A741cEE6A8cC5632B2d948C050303F6246D24" as const;

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
