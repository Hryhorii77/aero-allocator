import { concatHex, encodeFunctionData } from "viem";
import { parseAbi } from "viem";
import { DATA_SUFFIX } from "./attribution";

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

// Multicall3 (https://github.com/mds1/multicall) — deployed at this same
// address on essentially every EVM chain that has it, Base included; not
// protocol-specific like voterAddress/veSugarAddress, so unlike those it
// doesn't need to come from /api/protocol.
export const MULTICALL3_ADDRESS = "0xcA11bde05977b3631167028862bE2a173976CA11" as const;

export const multicall3Abi = parseAbi([
  "struct Call3 { address target; bool allowFailure; bytes callData; }",
  "struct Result { bool success; bytes returnData; }",
  "function aggregate3(Call3[] calldata calls) payable returns (Result[] memory returnData)",
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

/**
 * Multicall3.aggregate3 args that cast the identical allocation for every
 * veNFT id in `tokenIds`, each as its own Voter.vote() call, batched into
 * one transaction — so a wallet holding several locks (Flight School +
 * older max locks, the exact case BNKR/Grok flagged) signs once instead of
 * running the vote flow N times. Voter.vote()'s weights are relative,
 * normalized by each tokenId's own balance onchain (see buildVoteArgs), so
 * reusing the same pools/weights array per call reproduces the same
 * proportional split for every veNFT, each funded by its own voting power.
 * allowFailure: false — a bad tokenId (already voted, wrong owner, expired)
 * should revert the whole batch rather than silently skip a lock the caller
 * thought they were voting with.
 */
export function buildMulticallVoteArgs(
  voterAddress: `0x${string}`,
  tokenIds: string[],
  allocations: Array<{ pool: string; weightPct: number }>,
) {
  return [
    tokenIds.map((tokenId) => ({
      target: voterAddress,
      allowFailure: false,
      callData: encodeFunctionData({ abi: voterAbi, functionName: "vote", args: buildVoteArgs(tokenId, allocations) }),
    })),
  ] as const;
}

/**
 * Unsigned Voter.vote() calldata for the no-wallet-connect copy flow, with
 * the ERC-8021 Builder Code suffix appended (see lib/attribution.ts). The
 * connected-wallet path (wallet.tsx's castVote, via wagmi's writeContract)
 * gets this automatically from wagmi's client-level `dataSuffix` config —
 * it does NOT call this function — because that path never builds calldata
 * by hand. This one does, and never touches a wagmi client, so it has to
 * append the suffix itself.
 */
export function buildVoteCalldata(
  tokenId: string,
  allocations: Array<{ pool: string; weightPct: number }>,
) {
  const data = encodeFunctionData({ abi: voterAbi, functionName: "vote", args: buildVoteArgs(tokenId, allocations) });
  return concatHex([data, DATA_SUFFIX]);
}
