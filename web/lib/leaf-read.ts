import { createPublicClient, fallback, http, type Address } from "viem";
import { chainById } from "./aero-chains";
import { SAERO, saeroLeafAbi } from "./saero";

export interface LeafChainState {
  chainId: number;
  gauges: Array<{ gauge: Address; amount: bigint }>;
  /** What the chain's own leaf has booked on real gauges for the position, base units. */
  total: bigint;
  /** Power the leaf has parked on its idle entry (address zero): sent to the chain but not yet placed on a gauge, or left idle there. */
  idle: bigint;
  /** Unix seconds of the position's last gauge allocation on this chain; 0 if never. */
  lastAllocatedSec: number;
  /** This chain's wait between allocations, seconds. */
  cooldownSec: number;
}

/**
 * Reads one position's state straight from a chain's own leaf voter, in the browser: the same leaf address exists on every Aero chain.
 * The public nodes allow cross-origin reads, so the position never reaches our server.
 */
export async function readLeafChain(chainId: number, tokenId: bigint): Promise<LeafChainState> {
  const cfg = chainById(chainId);
  if (!cfg || cfg.rpcs.length === 0) throw new Error(`No node for chain ${chainId}`);
  const c = createPublicClient({ chain: cfg.chain, transport: fallback(cfg.rpcs.map((u) => http(u))) });
  const [list, state, cooldownSec] = await Promise.all([
    c.readContract({ address: SAERO.leafVoter, abi: saeroLeafAbi, functionName: "allocatedGauges", args: [tokenId] }) as Promise<Address[]>,
    c.readContract({ address: SAERO.leafVoter, abi: saeroLeafAbi, functionName: "tokenStates", args: [tokenId] }) as Promise<readonly [string, number, boolean, bigint]>,
    c.readContract({ address: SAERO.leafVoter, abi: saeroLeafAbi, functionName: "allocationCooldown" }).then(Number),
  ]);
  const amounts = await Promise.all(list.map((gauge) => c.readContract({ address: SAERO.leafVoter, abi: saeroLeafAbi, functionName: "allocations", args: [tokenId, gauge] }) as Promise<bigint>));
  const all = list.map((gauge, i) => ({ gauge, amount: amounts[i] })).filter((g) => g.amount > 0n);
  const isIdle = (g: { gauge: string }) => /^0x0+$/.test(g.gauge);
  const gauges = all.filter((g) => !isIdle(g));
  return {
    chainId,
    gauges,
    total: gauges.reduce((s, g) => s + g.amount, 0n),
    idle: all.filter(isIdle).reduce((s, g) => s + g.amount, 0n),
    lastAllocatedSec: Number(state[1]),
    cooldownSec,
  };
}
