import { getAddress, isAddress, type Address } from "viem";
import { BASE_CHAIN } from "./aero-chains";
import { client } from "./gauges";
import type { CurrentGauge } from "./position-advice";
import { DEFAULT_COOLDOWN_SEC, SAERO, saeroEscrowAbi, saeroLeafAbi, saeroVoterAbi, SAERO_CHAIN_ID, type SaeroPosition } from "./saero";

const toTokens = (v: bigint) => Number(v) / 1e18;
export const MAX_OWNER_POSITIONS = 10;

export interface ServerPosition extends SaeroPosition {
  owner: Address;
}

/** The leaf voter's allocation cooldown, falling back to the 47 hours Aero launched with when it can't be read. */
export async function readCooldownSec(): Promise<number> {
  return client(BASE_CHAIN)
    .readContract({ address: SAERO.leafVoter, abi: saeroLeafAbi, functionName: "allocationCooldown" })
    .then(Number)
    .catch(() => DEFAULT_COOLDOWN_SEC);
}

/** One position's state on Base, or null when no such position exists. */
export async function readPosition(tokenId: bigint): Promise<ServerPosition | null> {
  const c = client(BASE_CHAIN);
  const owner = await c.readContract({ address: SAERO.votingEscrow, abi: saeroEscrowAbi, functionName: "ownerOf", args: [tokenId] }).catch(() => null);
  if (!owner || /^0x0+$/.test(owner)) return null;
  const [staked, vp, state, leaf, parkedRaw, onBaseRaw] = (await c.multicall({
    allowFailure: false,
    contracts: [
      { address: SAERO.votingEscrow, abi: saeroEscrowAbi, functionName: "staked", args: [tokenId] },
      { address: SAERO.votingEscrow, abi: saeroEscrowAbi, functionName: "balanceOfNFT", args: [tokenId] },
      { address: SAERO.voter, abi: saeroVoterAbi, functionName: "tokenStates", args: [tokenId] },
      { address: SAERO.leafVoter, abi: saeroLeafAbi, functionName: "tokenStates", args: [tokenId] },
      { address: SAERO.voter, abi: saeroVoterAbi, functionName: "allocationChainAmounts", args: [tokenId, 0n] },
      { address: SAERO.voter, abi: saeroVoterAbi, functionName: "allocationChainAmounts", args: [tokenId, BigInt(SAERO_CHAIN_ID)] },
    ],
  })) as unknown as [{ amount: bigint; end: number; isPermanent: boolean }, bigint, readonly [bigint, number, number, boolean], readonly [string, number, boolean, bigint], bigint, bigint];
  return {
    owner: getAddress(owner),
    tokenId,
    staked: toTokens(staked.amount),
    votingPower: toTokens(vp),
    endSec: staked.isPermanent ? 0 : Number(staked.end),
    isPermanent: staked.isPermanent,
    committed: toTokens(state[0]),
    parked: toTokens(parkedRaw),
    parkedRaw,
    onBaseRaw,
    lastAllocatedSec: Number(leaf[1]),
  };
}

/** The position ids an address holds (at most MAX_OWNER_POSITIONS), in the escrow's order. */
export async function readOwnerTokenIds(owner: string): Promise<{ owner: Address; tokenIds: bigint[]; total: number }> {
  if (!isAddress(owner)) throw new Error("not an address");
  const addr = getAddress(owner);
  const c = client(BASE_CHAIN);
  const total = Number(await c.readContract({ address: SAERO.votingEscrow, abi: saeroEscrowAbi, functionName: "balanceOf", args: [addr] }));
  const n = Math.min(total, MAX_OWNER_POSITIONS);
  if (n === 0) return { owner: addr, tokenIds: [], total };
  const ids = (await c.multicall({
    allowFailure: false,
    contracts: Array.from({ length: n }, (_, i) => ({ address: SAERO.votingEscrow, abi: saeroEscrowAbi, functionName: "tokenOfOwnerByIndex" as const, args: [addr, BigInt(i)] as const })),
  })) as bigint[];
  return { owner: addr, tokenIds: ids, total };
}

/** The gauges a position sits on now, with each one's share of its Base amount. Empty when it has none. */
export async function readCurrentGauges(tokenId: bigint, symbolOf: (gauge: string) => string): Promise<CurrentGauge[]> {
  const c = client(BASE_CHAIN);
  const gauges = (await c.readContract({ address: SAERO.leafVoter, abi: saeroLeafAbi, functionName: "allocatedGauges", args: [tokenId] })) as Address[];
  if (gauges.length === 0) return [];
  const amounts = (await c.multicall({
    allowFailure: false,
    contracts: gauges.map((gauge) => ({ address: SAERO.leafVoter, abi: saeroLeafAbi, functionName: "allocations" as const, args: [tokenId, gauge] as const })),
  })) as bigint[];
  const total = amounts.reduce((a, b) => a + b, 0n);
  if (total === 0n) return [];
  return gauges
    .map((gauge, i) => ({ gauge, symbol: symbolOf(gauge), pct: Number((amounts[i] * 10_000n) / total) / 100, raw: amounts[i] }))
    .filter((x) => x.raw > 0n && !/^0x0+$/.test(x.gauge))
    .sort((a, b) => b.pct - a.pct)
    .map(({ gauge, symbol, pct }) => ({ gauge, symbol, pct }));
}
