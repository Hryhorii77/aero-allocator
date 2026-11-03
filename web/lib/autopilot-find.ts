import type { Address } from "viem";
import { BASE_CHAIN } from "./aero-chains";
import { AUTOPILOT_FACTORY, KNOWN_AUTOPILOT_POOLS } from "./autopilot";
import { client } from "./gauges";
import { SAERO, saeroEscrowAbi } from "./saero";

const factoryAbi = [{ type: "function", name: "factory", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] }] as const;
/** The largest positions checked for an Autopilot owner besides the known pools, so a new Autopilot option shows up on its own. */
const SCAN_TOP = 50;

/** The positions whose owner is a clone made by Autopilot's factory, among the known pools and the largest positions. */
export async function findAutopilotPools(powers: Array<{ tokenId: number; power: number }>): Promise<Array<{ tokenId: number; power: number }>> {
  const byId = new Map(powers.map((p) => [p.tokenId, p.power]));
  const largest = [...powers].sort((a, b) => b.power - a.power).slice(0, SCAN_TOP).map((p) => p.tokenId);
  const ids = [...new Set([...KNOWN_AUTOPILOT_POOLS, ...largest])];
  const c = client(BASE_CHAIN);
  const owners = await c.multicall({ allowFailure: true, contracts: ids.map((id) => ({ address: SAERO.votingEscrow, abi: saeroEscrowAbi, functionName: "ownerOf" as const, args: [BigInt(id)] as const })) });
  const ownerOf = ids.map((id, i) => ({ id, owner: owners[i].status === "success" ? (owners[i].result as Address) : null }));
  const withOwner = ownerOf.filter((o): o is { id: number; owner: Address } => !!o.owner);
  // A wallet or a contract without factory() simply fails this read and is left out.
  const factories = await c.multicall({ allowFailure: true, contracts: withOwner.map((o) => ({ address: o.owner, abi: factoryAbi, functionName: "factory" as const })) });
  return withOwner
    .filter((_, i) => factories[i].status === "success" && String(factories[i].result).toLowerCase() === AUTOPILOT_FACTORY.toLowerCase())
    .map((o) => ({ tokenId: o.id, power: byId.get(o.id) ?? 0 }))
    .filter((p) => p.power > 0)
    .sort((a, b) => b.power - a.power);
}

