import type { Address } from "viem";
import { BASE_CHAIN } from "./aero-chains";
import { allocateAbi, allocateArgs, explainAllocateError, type AllocatePlan } from "./allocate";
import type { AllocateStep } from "./allocate-multichain";
import { client } from "./gauges";
import { SAERO } from "./saero";

export type Simulation = { ok: true; gasEstimate: string | null } | { ok: false; reason: string };

/**
 * Runs `allocate` as the position's owner against Base's current state without sending anything, so a call that would be rejected
 * (cooldown, wrong total, not the owner) is reported with a plain reason instead of failing on-chain. The reason is one of the
 * Voter's known errors in words, never the node's raw message.
 */
export async function simulateAllocate(plan: AllocatePlan, owner: Address): Promise<Simulation> {
  const c = client(BASE_CHAIN);
  const request = { address: SAERO.voter, abi: allocateAbi, functionName: "allocate" as const, args: allocateArgs(plan, owner), account: owner };
  try {
    await c.simulateContract(request);
  } catch (e) {
    return { ok: false, reason: explainAllocateError(e) ?? "the Voter would reject this call right now" };
  }
  const gas = await c.estimateContractGas(request).catch(() => null);
  return { ok: true, gasEstimate: gas === null ? null : gas.toString() };
}

/**
 * The same check for one step of a multi-chain plan: `allocate` as the owner with the step's ETH attached, against Base's current state.
 * A later step depends on the earlier one having landed, so only the step that can be sent now is simulated.
 */
export async function simulateStep(step: AllocateStep, owner: Address): Promise<Simulation> {
  const c = client(BASE_CHAIN);
  const request = { address: SAERO.voter, abi: allocateAbi, functionName: "allocate" as const, args: step.args, value: step.valueWei, account: owner };
  try {
    await c.simulateContract(request);
  } catch (e) {
    return { ok: false, reason: explainAllocateError(e) ?? "the Voter would reject this call right now" };
  }
  const gas = await c.estimateContractGas(request).catch(() => null);
  return { ok: true, gasEstimate: gas === null ? null : gas.toString() };
}
