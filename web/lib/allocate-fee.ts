import { parseAbi, type Address } from "viem";
import { BASE_CHAIN } from "./aero-chains";
import { client } from "./gauges";

/** Aero's root message orchestrator on Base: it knows each leaf chain's message adapter and what a return costs. */
export const ORCHESTRATOR: Address = "0x4F347Fec2aEb8fdB569045AF4D0806eE7f7F6194";

/**
 * Destination gas budgets matching what Aero's own app sends (read from real allocations: 300-350k for the
 * chain step, 750k-1.4M for the gauge step, growing with the number of gauges). Too little gas strands the
 * message, so this errs to the high side of what was seen.
 */
export const CHAIN_STEP_GAS = 350_000n;
export const gaugeStepGas = (gauges: number): bigint => 575_000n + 275_000n * BigInt(Math.max(1, gauges));

const abi = parseAbi([
  "function adapters(uint256 chainId) view returns (address)",
  "function deallocationReturnCost(uint256 chainId) view returns (uint256)",
]);
const adapterAbi = parseAbi(["function quoteMessage(bytes message, uint256 gasLimit, address refundRecipient) view returns (uint256)"]);

export type CrossChainFee = {
  chainId: number;
  gauges: number;
  /** Wei for the step that moves power to the chain. */
  chainStep: string;
  /** Wei for the step that sets the gauges there. */
  gaugeStep: string;
  /** Both steps: what an allocation to this chain needs as msg.value. */
  total: string;
  /** Wei kept when power later comes back from this chain. */
  returnCost: string;
};

/**
 * What allocating to another chain costs in ETH on Base, read from the chain's own adapter (the same call the contract
 * makes when it sends). The fee is priced on destination gas, not on the message, so a placeholder message quotes exactly.
 */
export async function quoteCrossChain(chainId: number, gauges: number): Promise<CrossChainFee> {
  if (chainId === BASE_CHAIN.id) throw new Error("Base needs no cross-chain fee");
  const c = client(BASE_CHAIN);
  const adapter = await c.readContract({ address: ORCHESTRATOR, abi, functionName: "adapters", args: [BigInt(chainId)] });
  if (/^0x0+$/.test(adapter)) throw new Error("no adapter for this chain");
  const quote = (gas: bigint) =>
    c.readContract({ address: adapter, abi: adapterAbi, functionName: "quoteMessage", args: ["0x" + "00".repeat(160) as `0x${string}`, gas, "0x000000000000000000000000000000000000dEaD"] });
  const [chainStep, gaugeStep, returnCost] = await Promise.all([
    quote(CHAIN_STEP_GAS),
    quote(gaugeStepGas(gauges)),
    c.readContract({ address: ORCHESTRATOR, abi, functionName: "deallocationReturnCost", args: [BigInt(chainId)] }),
  ]);
  return { chainId, gauges, chainStep: chainStep.toString(), gaugeStep: gaugeStep.toString(), total: (chainStep + gaugeStep).toString(), returnCost: returnCost.toString() };
}

/**
 * The fee as a straight line in destination gas (the adapter prices gas, not the message): two quotes give the cost of the chain
 * step and of a gauge step for any number of gauges, without one read per gauge count. Used to compare chains; the final plan
 * is re-quoted exactly with `quoteCrossChain`.
 */
export type CrossChainCostModel = { chainId: number; chainStepWei: bigint; gaugeBaseWei: bigint; perGaugeWei: bigint };

export async function quoteCostModel(chainId: number): Promise<CrossChainCostModel> {
  if (chainId === BASE_CHAIN.id) throw new Error("Base needs no cross-chain fee");
  const c = client(BASE_CHAIN);
  const adapter = await c.readContract({ address: ORCHESTRATOR, abi, functionName: "adapters", args: [BigInt(chainId)] });
  if (/^0x0+$/.test(adapter)) throw new Error("no adapter for this chain");
  const quote = (gas: bigint) =>
    c.readContract({ address: adapter, abi: adapterAbi, functionName: "quoteMessage", args: ["0x" + "00".repeat(160) as `0x${string}`, gas, "0x000000000000000000000000000000000000dEaD"] });
  const [chainStepWei, one, six] = await Promise.all([quote(CHAIN_STEP_GAS), quote(gaugeStepGas(1)), quote(gaugeStepGas(6))]);
  const perGaugeWei = six > one ? (six - one) / 5n : 0n;
  return { chainId, chainStepWei, gaugeBaseWei: one - perGaugeWei, perGaugeWei };
}

/** Wei an allocation of `gauges` gauges on the chain needs as msg.value, from the cost model. */
export const modelFeeWei = (m: CrossChainCostModel, gauges: number): bigint => m.chainStepWei + m.gaugeBaseWei + m.perGaugeWei * BigInt(Math.max(1, gauges));
