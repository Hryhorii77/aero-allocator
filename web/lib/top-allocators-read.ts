import type { Address } from "viem";
import { BASE_CHAIN } from "./aero-chains";
import { client } from "./gauges";
import { SAERO, saeroEscrowAbi, saeroLeafAbi, saeroVoterAbi, SAERO_CHAIN_ID } from "./saero";
import { copyShares, topByPower, TOP_ALLOCATORS, type TopAllocators } from "./top-allocators";
import { findAutopilotPools } from "./autopilot-find";

const escrowSupplyAbi = [{ type: "function", name: "totalSupply", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] }] as const;
const BATCH = 1000;
const TTL_MS = 30 * 60_000;
const toTokens = (v: bigint) => Number(v) / 1e18;

let cached: { at: number; value: TopAllocators } | null = null;
let inflight: Promise<TopAllocators> | null = null;
let powersCached: { at: number; value: Array<{ tokenId: number; power: number }> } | null = null;
let powersInflight: Promise<Array<{ tokenId: number; power: number }>> | null = null;

/**
 * Every position's voting power, whole tokens (ids run from 1 to the escrow's totalSupply; about 22,000 on 2026-11-03, about seven
 * seconds in batches of 1,000). Kept 30 minutes and shared by the top-allocators and Autopilot reads.
 */
export async function readAllPowers(nowMs = Date.now()): Promise<Array<{ tokenId: number; power: number }>> {
  if (powersCached && nowMs - powersCached.at < TTL_MS) return powersCached.value;
  powersInflight ??= (async () => {
    const c = client(BASE_CHAIN);
    const n = Number(await c.readContract({ address: SAERO.votingEscrow, abi: escrowSupplyAbi, functionName: "totalSupply" }));
    const powers: Array<{ tokenId: number; power: number }> = [];
    for (let start = 1; start <= n; start += BATCH) {
      const ids = Array.from({ length: Math.min(BATCH, n - start + 1) }, (_, k) => BigInt(start + k));
      const res = await c.multicall({ allowFailure: true, contracts: ids.map((id) => ({ address: SAERO.votingEscrow, abi: saeroEscrowAbi, functionName: "balanceOfNFT" as const, args: [id] as const })) });
      res.forEach((r, k) => r.status === "success" && powers.push({ tokenId: Number(ids[k]), power: toTokens(r.result as bigint) }));
    }
    powersCached = { at: nowMs, value: powers };
    return powers;
  })().finally(() => {
    powersInflight = null;
  });
  return powersInflight;
}

/**
 * Takes the largest TOP_ALLOCATORS of every position's power (readAllPowers), and reads each one's Base gauges and amount. Kept for 30 minutes:
 * big positions move at most once per wait, so a fresher read would only cost the nodes more.
 */
export async function readTopAllocators(nowMs = Date.now()): Promise<TopAllocators> {
  if (cached && nowMs - cached.at < TTL_MS) return cached.value;
  inflight ??= (async () => {
    const c = client(BASE_CHAIN);
    const powers = await readAllPowers(nowMs);
    const top = topByPower(powers, TOP_ALLOCATORS);
    const allocators = await Promise.all(
      top.map(async ({ tokenId, power }) => {
        const id = BigInt(tokenId);
        const [gauges, onBase] = (await c.multicall({
          allowFailure: false,
          contracts: [
            { address: SAERO.leafVoter, abi: saeroLeafAbi, functionName: "allocatedGauges", args: [id] },
            { address: SAERO.voter, abi: saeroVoterAbi, functionName: "allocationChainAmounts", args: [id, BigInt(SAERO_CHAIN_ID)] },
          ],
        })) as [Address[], bigint];
        const amounts = gauges.length
          ? ((await c.multicall({ allowFailure: false, contracts: gauges.map((g) => ({ address: SAERO.leafVoter, abi: saeroLeafAbi, functionName: "allocations" as const, args: [id, g] as const })) })) as bigint[])
          : [];
        return { tokenId: String(tokenId), power, onBase: toTokens(onBase), parts: copyShares(gauges.map((g, i) => ({ gauge: g.toLowerCase(), raw: amounts[i] ?? 0n }))) };
      }),
    );
    // Autopilot's pools are big enough to be listed; say so, so nobody mistakes them for one person's choice.
    const autopilot = new Set((await findAutopilotPools(powers).catch(() => [])).map((p) => String(p.tokenId)));
    for (const a of allocators) if (autopilot.has(a.tokenId)) Object.assign(a, { autopilot: true });
    const value: TopAllocators = { generatedAt: nowMs, totalPower: powers.reduce((s, p) => s + p.power, 0), allocators };
    cached = { at: nowMs, value };
    return value;
  })().finally(() => {
    inflight = null;
  });
  return inflight;
}
