import { type Abi, encodeFunctionData, parseAbi } from "viem";

/**
 * Adapter for Aerodrome's Predictive Allocation mechanism (launching September
 * 2026 alongside the Aerodrome/Velodrome "Aero" merger — pushed back from the
 * original July 2026 target).
 *
 * As of 2026-08-16 Dromos Labs has announced the mechanism (real-time,
 * prediction-market-style incentive allocation replacing weekly gauge voting)
 * but has not published contract addresses or an ABI. Guessing a specific
 * function signature now would just be dead code to delete later, so instead
 * this adapter is fully config-driven: once Dromos publishes the real
 * address/ABI, wiring it live is an env var change, not a code change.
 *
 * Execution intentionally returns unsigned call data: signing and submission
 * belong to the host agent's wallet layer (e.g. Base MCP `send_calls` with
 * explicit user approval), never to this server.
 */

export interface PreparedCall {
  to: `0x${string}`;
  data: `0x${string}`;
  value: string;
  description: string;
}

export interface SubmissionInput {
  /** veAERO NFT id, if the live mechanism still keys off veNFTs. */
  veNftId?: number;
  allocations: Array<{ pool: string; weightPct: number }>;
}

export interface PredictiveAllocationAdapter {
  /** Whether the live mechanism's contracts are configured. */
  isLive(): boolean;
  /** Translate an allocation into unsigned calls for the host wallet. */
  prepareSubmission(input: SubmissionInput): Promise<PreparedCall[]>;
}

export class NotYetLiveAdapter implements PredictiveAllocationAdapter {
  isLive(): boolean {
    return false;
  }

  async prepareSubmission(_input: SubmissionInput): Promise<PreparedCall[]> {
    throw new Error(
      "Predictive Allocation contracts are not published yet. " +
        "Use the recommendation output with the classic Voter.vote() flow (prepare_vote_calldata), or " +
        "set AERO_PREDICTIVE_ALLOCATION_* env vars once Dromos Labs releases addresses/ABI — see README.",
    );
  }
}

/**
 * Each supported role fills one positional argument of the configured
 * function from a `SubmissionInput`. `weightsBps` matches the scaling
 * `Voter.vote()` uses today (100 = 1%); `weightsWad` covers a fraction-of-1e18
 * convention some mechanisms use instead — pick whichever the real ABI wants
 * via `AERO_PREDICTIVE_ALLOCATION_ARGS`.
 */
const ARG_BUILDERS: Record<string, (input: SubmissionInput) => unknown> = {
  veNftId: (input) => {
    if (input.veNftId === undefined) {
      throw new Error("This submission requires veNftId, but none was provided.");
    }
    return BigInt(input.veNftId);
  },
  pools: (input) => input.allocations.map((a) => a.pool as `0x${string}`),
  weightsBps: (input) => input.allocations.map((a) => BigInt(Math.round(a.weightPct * 100))),
  weightsWad: (input) => input.allocations.map((a) => BigInt(Math.round(a.weightPct * 1e16))),
};

interface LiveConfig {
  address: `0x${string}`;
  abi: readonly string[];
  functionName: string;
  args: string[];
}

export function loadLiveConfig(): LiveConfig | null {
  const address = process.env.AERO_PREDICTIVE_ALLOCATION_ADDRESS;
  const abiJson = process.env.AERO_PREDICTIVE_ALLOCATION_ABI;
  const functionName = process.env.AERO_PREDICTIVE_ALLOCATION_FUNCTION;
  const argsJson = process.env.AERO_PREDICTIVE_ALLOCATION_ARGS;
  if (!address || !abiJson || !functionName || !argsJson) return null;

  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
    throw new Error(`AERO_PREDICTIVE_ALLOCATION_ADDRESS is not a valid address: ${address}`);
  }
  const abi = JSON.parse(abiJson);
  const args = JSON.parse(argsJson);
  if (!Array.isArray(abi) || !Array.isArray(args)) {
    throw new Error("AERO_PREDICTIVE_ALLOCATION_ABI and AERO_PREDICTIVE_ALLOCATION_ARGS must be JSON arrays.");
  }
  for (const role of args) {
    if (!(role in ARG_BUILDERS)) {
      throw new Error(
        `Unknown arg role "${role}" in AERO_PREDICTIVE_ALLOCATION_ARGS. Supported: ${Object.keys(ARG_BUILDERS).join(", ")}`,
      );
    }
  }
  return { address: address as `0x${string}`, abi, functionName, args };
}

export class LiveAdapter implements PredictiveAllocationAdapter {
  constructor(private cfg: LiveConfig) {}

  isLive(): boolean {
    return true;
  }

  async prepareSubmission(input: SubmissionInput): Promise<PreparedCall[]> {
    // Config is runtime-supplied (env vars), so the ABI/function/args triple can't be
    // statically checked against each other the way viem's literal-type inference wants.
    const abi = parseAbi(this.cfg.abi as [string, ...string[]]) as Abi;
    const args = this.cfg.args.map((role) => ARG_BUILDERS[role](input));
    const data = encodeFunctionData({ abi, functionName: this.cfg.functionName, args } as Parameters<
      typeof encodeFunctionData
    >[0]);
    return [
      {
        to: this.cfg.address,
        data,
        value: "0",
        description:
          `Predictive Allocation submission via ${this.cfg.functionName}() across ${input.allocations.length} pools.`,
      },
    ];
  }
}

function buildAdapter(): PredictiveAllocationAdapter {
  const cfg = loadLiveConfig();
  return cfg ? new LiveAdapter(cfg) : new NotYetLiveAdapter();
}

export const adapter: PredictiveAllocationAdapter = buildAdapter();
