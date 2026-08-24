#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { encodeFunctionData, parseAbi } from "viem";
import { z } from "zod";
import { ADDRESSES, PRESET } from "./config.js";
import { fetchEpochHistory, getRewardTokenPriceUsd, scanPools } from "./data.js";
import {
  applyConfidenceCalibration,
  detectVoteSwings,
  getMarketSnapshot,
  recommendAllocation,
  recommendLpDeposits,
  simulateBribeImpact,
  summarizeHistory,
} from "./scoring.js";
import { getBacktestReport } from "./backtest.js";
import { adapter } from "./adapters/predictive-allocation.js";

const server = new McpServer({
  name: "aero-allocator",
  version: "0.1.0",
});

// Static description text below is generated once at process startup for the
// protocol selected via AERO_PROTOCOL (config.js) — one process serves one
// protocol, so this is safe to bake in rather than resolve per call.

function json(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

function err(message: string) {
  return { content: [{ type: "text" as const, text: message }], isError: true };
}

/**
 * Snapshot with confidence recalibrated against backtested accuracy, when
 * available. Fetches the snapshot and the (usually cache-warm) backtest
 * report concurrently; any backtest failure just falls back to the raw
 * heuristic confidence rather than breaking the calling tool.
 */
async function calibratedSnapshot(refresh: boolean) {
  const [snap, calibration] = await Promise.all([
    getMarketSnapshot(refresh),
    getBacktestReport()
      .then((r) => r.confidenceCalibration)
      .catch(() => undefined),
  ]);
  return calibration ? applyConfidenceCalibration(snap, calibration) : snap;
}

server.registerTool(
  "scan_pools",
  {
    description:
      `Scan ${PRESET.displayName} (${PRESET.networkName}) gauge-enabled pools with live TVL, staked TVL, fee ` +
      "tier and emissions. Sorted by staked TVL. Use this for a market overview before predicting demand.",
    inputSchema: {
      limit: z.number().int().min(1).max(100).default(25).describe("Max pools to return"),
      minTvlUsd: z.number().min(0).default(50000).describe("Minimum pool TVL in USD"),
    },
  },
  async ({ limit, minTvlUsd }) => {
    const pools = await scanPools({ minTvlUsd, maxPools: limit });
    return json(
      pools.map((p) => ({
        pool: p.lp,
        symbol: p.symbol,
        type: p.poolType,
        tvlUsd: Math.round(p.tvlUsd),
        stakedTvlUsd: Math.round(p.stakedTvlUsd),
        poolFeeBps: p.poolFeeBps,
      })),
    );
  },
);

server.registerTool(
  "pool_history",
  {
    description:
      `Per-epoch history for one ${PRESET.displayName} pool: votes, ${PRESET.tokenSymbol} emissions, ` +
      "trading fees (USD) and bribes/incentives (USD) per weekly epoch, newest first (first row is the " +
      "in-progress epoch).",
    inputSchema: {
      pool: z.string().regex(/^0x[0-9a-fA-F]{40}$/).describe("Pool (lp) address"),
      epochs: z.number().int().min(2).max(50).default(8),
    },
  },
  async ({ pool, epochs }) => {
    const history = await fetchEpochHistory(pool, epochs);
    if (history.length === 0)
      return err(`No epoch data found for ${pool}. Is it a gauge-enabled ${PRESET.displayName} pool?`);
    return json(summarizeHistory(history));
  },
);

server.registerTool(
  "predict_demand",
  {
    description:
      `Forecast next-epoch trading-fee demand for top ${PRESET.displayName} pools and compare it with ` +
      "current vote allocation. Key output: predictiveEdgePct — pools with positive edge are " +
      "under-incentivized relative to predicted demand (the signal a Predictive-Allocation-style mechanism " +
      "would reward). Data is cached ~5 min.",
    inputSchema: {
      limit: z.number().int().min(1).max(60).default(20).describe("Max pools to return"),
      sortBy: z.enum(["predicted_fees", "predictive_edge", "voter_roi"]).default("predicted_fees"),
      refresh: z.boolean().default(false).describe("Force a fresh onchain snapshot"),
    },
  },
  async ({ limit, sortBy, refresh }) => {
    const snap = await calibratedSnapshot(refresh);
    const sorted = [...snap.forecasts].sort((a, b) => {
      if (sortBy === "predictive_edge") return b.predictiveEdge - a.predictiveEdge;
      if (sortBy === "voter_roi") return b.rewardPer1kVotesUsd - a.rewardPer1kVotesUsd;
      return b.predictedFeesUsd - a.predictedFeesUsd;
    });
    return json(
      sorted.slice(0, limit).map((f) => ({
        pool: f.pool.lp,
        symbol: f.pool.symbol,
        predictedFeesUsd: f.predictedFeesUsd,
        lastEpochFeesUsd: f.lastEpochFeesUsd,
        feeTrendUsdPerEpoch: f.feeTrendUsdPerEpoch,
        currentBribesUsd: f.currentBribesUsd,
        currentVoteSharePct: Math.round(f.voteShare * 10000) / 100,
        predictedDemandSharePct: Math.round(f.predictedDemandShare * 10000) / 100,
        predictiveEdgePct: Math.round(f.predictiveEdge * 10000) / 100,
        rewardPer1kVotesUsd: f.rewardPer1kVotesUsd,
        confidence: f.confidence,
      })),
    );
  },
);

server.registerTool(
  "recommend_allocation",
  {
    description:
      `Produce a concrete incentive-allocation recommendation across ${PRESET.displayName} pools. ` +
      "objective=protocol_efficiency allocates proportional to predicted next-epoch fee demand " +
      "(the Predictive-Allocation-style ideal). objective=voter_roi maximizes the expected next-epoch reward " +
      `for votingPowerVe ${PRESET.veTokenSymbol}, accounting for self-dilution (your votes shrink the ` +
      `per-vote payout), so pass the voter's real ${PRESET.veTokenSymbol} amount for sized weights. Returns ` +
      "weights that sum to 100%.",
    inputSchema: {
      objective: z.enum(["protocol_efficiency", "voter_roi"]).default("voter_roi"),
      maxPools: z.number().int().min(2).max(20).default(8),
      votingPowerVe: z
        .number()
        .min(1)
        .default(10000)
        .describe(`${PRESET.veTokenSymbol} voting power to allocate (voter_roi only)`),
      maxWeightPct: z
        .number()
        .min(5)
        .max(100)
        .default(35)
        .describe("Per-pool concentration cap in percent (voter_roi only)"),
      refresh: z.boolean().default(false),
    },
  },
  async ({ objective, maxPools, votingPowerVe, maxWeightPct, refresh }) => {
    const snap = await calibratedSnapshot(refresh);
    return json(recommendAllocation(snap, objective, maxPools, votingPowerVe, maxWeightPct / 100));
  },
);

server.registerTool(
  "recommend_bribe_placement",
  {
    description:
      "For a team/protocol deciding where to spend a bribe budget (not a voter deciding how to vote): " +
      `estimate how much ${PRESET.veTokenSymbol} vote share a bribe would pull toward one pool. Models a full re-optimization ` +
      "of the market's active voting power by payout (votes scale with the square root of pool payout), so a " +
      "bribe dollar pulls disproportionately more on cheap/low-payout pools than on already-large ones — an " +
      "optimistic upper bound, since real voters re-vote slowly. Also reports which other pools lose the most " +
      "votes as the market rebalances.",
    inputSchema: {
      pool: z.string().regex(/^0x[0-9a-fA-F]{40}$/).describe("Pool (lp) address to bribe"),
      bribeBudgetUsd: z.number().min(1).describe("Bribe budget in USD to add to this pool"),
      maxWeightPct: z
        .number()
        .min(5)
        .max(100)
        .default(35)
        .describe("Per-pool concentration cap used by the underlying water-fill model, in percent"),
      refresh: z.boolean().default(false),
    },
  },
  async ({ pool, bribeBudgetUsd, maxWeightPct, refresh }) => {
    const snap = await calibratedSnapshot(refresh);
    try {
      return json(simulateBribeImpact(snap, pool, bribeBudgetUsd, maxWeightPct / 100));
    } catch (e) {
      return err(e instanceof Error ? e.message : String(e));
    }
  },
);

server.registerTool(
  "recommend_lp_deposit",
  {
    description:
      "Forward-looking staking-yield ranking for LPs deciding where to deposit and stake liquidity — " +
      `deliberately NOT trading-fee revenue: on ${PRESET.displayName}, fees and bribes accrue to ` +
      `${PRESET.veTokenSymbol} voters, not to liquidity stakers (see recommend_allocation), so this ranks ` +
      `by predicted ${PRESET.tokenSymbol} emissions instead, the actual staker reward. ` +
      "predictedNextEpochAprPct forecasts next-epoch emissions from each pool's emissions history the same " +
      "way predict_demand forecasts fees; currentEpochAprPct uses this epoch's already-fixed live emission " +
      "rate (no forecast error).",
    inputSchema: {
      maxPools: z.number().int().min(1).max(60).default(20),
      minStakedTvlUsd: z.number().min(0).default(1000).describe("Minimum staked TVL for a pool to be ranked"),
      refresh: z.boolean().default(false),
    },
  },
  async ({ maxPools, minStakedTvlUsd, refresh }) => {
    const [snap, rewardTokenPriceUsd] = await Promise.all([getMarketSnapshot(refresh), getRewardTokenPriceUsd()]);
    try {
      return json(recommendLpDeposits(snap, rewardTokenPriceUsd, { maxPools, minStakedTvlUsd }));
    } catch (e) {
      return err(e instanceof Error ? e.message : String(e));
    }
  },
);

server.registerTool(
  "detect_vote_swings",
  {
    description:
      "Flag pools where the in-progress epoch is running well off its own historical trend in bribes or " +
      "votes — the 'an incentivized pool is suddenly drawing votes away from regular pools right before " +
      "lock' pattern. risers: bribes running ahead of the pool's normal pace (the early signal — a bribe " +
      "can appear in one transaction). fallers: votes running behind the pool's normal pace (the effect, " +
      "once other voters have reacted). Most useful late in the epoch, close to vote lock; noisy early on.",
    inputSchema: {
      maxPools: z.number().int().min(1).max(30).default(10),
      refresh: z.boolean().default(false),
    },
  },
  async ({ maxPools, refresh }) => {
    const snap = await getMarketSnapshot(refresh);
    return json(detectVoteSwings(snap, { maxPools }));
  },
);

// Classic ve-token voting is live today; Predictive Allocation submission
// (Aerodrome-specific, see predictive_allocation_status) goes through the
// adapter once Dromos publishes contracts.
const voterAbi = parseAbi([
  "function vote(uint256 _tokenId, address[] _poolVote, uint256[] _weights)",
]);

server.registerTool(
  "prepare_vote_calldata",
  {
    description:
      `Build unsigned transaction calldata for ${PRESET.displayName} Voter.vote() from an allocation ` +
      `(${PRESET.veTokenSymbol} NFT id + pool weights). Returns { to, data, value } for the host wallet ` +
      `(e.g. Base MCP send/send_calls on Base, or the equivalent for ${PRESET.networkName}) to review, sign ` +
      "and submit — this server never signs. Note: votes can only be cast once per epoch per veNFT, and " +
      "not in the final hour before epoch flip.",
    inputSchema: {
      veNftId: z.number().int().min(1).describe(`${PRESET.veTokenSymbol} NFT token id that holds the voting power`),
      allocations: z
        .array(
          z.object({
            pool: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
            weightPct: z.number().min(0.01).max(100),
          }),
        )
        .min(1)
        .max(30),
    },
  },
  async ({ veNftId, allocations }) => {
    const total = allocations.reduce((s, a) => s + a.weightPct, 0);
    if (Math.abs(total - 100) > 0.5) {
      return err(`Allocation weights must sum to 100% (got ${total.toFixed(2)}%).`);
    }
    // Voter.vote() normalizes weights internally; scale to integers.
    const data = encodeFunctionData({
      abi: voterAbi,
      functionName: "vote",
      args: [
        BigInt(veNftId),
        allocations.map((a) => a.pool as `0x${string}`),
        allocations.map((a) => BigInt(Math.round(a.weightPct * 100))),
      ],
    });
    return json({
      to: ADDRESSES.voter,
      data,
      value: "0",
      description: `Vote with ${PRESET.veTokenSymbol} #${veNftId} across ${allocations.length} pools: ${allocations
        .map((a) => `${a.weightPct}% → ${a.pool.slice(0, 10)}…`)
        .join(", ")}`,
      note: `Review pools and weights, then submit via your wallet (e.g. Base MCP send_calls on Base, or the equivalent for ${PRESET.networkName}) with user approval.`,
    });
  },
);

server.registerTool(
  "prepare_submission",
  {
    description:
      "Build unsigned transaction calldata for direct Predictive Allocation submission, once Dromos Labs' " +
      "contracts are wired in via AERO_PREDICTIVE_ALLOCATION_* env vars (see predictive_allocation_status " +
      "and README). Same shape as prepare_vote_calldata. Fails with a clear error if contracts aren't live " +
      "yet — use prepare_vote_calldata for the classic Voter.vote() flow until then.",
    inputSchema: {
      veNftId: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe(`${PRESET.veTokenSymbol} NFT id, if the live mechanism requires one`),
      allocations: z
        .array(
          z.object({
            pool: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
            weightPct: z.number().min(0.01).max(100),
          }),
        )
        .min(1)
        .max(30),
    },
  },
  async ({ veNftId, allocations }) => {
    const total = allocations.reduce((s, a) => s + a.weightPct, 0);
    if (Math.abs(total - 100) > 0.5) {
      return err(`Allocation weights must sum to 100% (got ${total.toFixed(2)}%).`);
    }
    try {
      const calls = await adapter.prepareSubmission({ veNftId, allocations });
      return json({
        calls,
        note: "Review pools and weights, then submit via your wallet with user approval. This server never signs.",
      });
    } catch (e) {
      return err(e instanceof Error ? e.message : String(e));
    }
  },
);

server.registerTool(
  "predictive_allocation_status",
  {
    description:
      "Status of the direct Predictive Allocation submission path (Aerodrome-specific: Dromos Labs' " +
      "September 2026 mechanism replacing weekly gauge voting). Reports whether live contracts are wired " +
      `into this server, and — since this server is currently configured for ${PRESET.displayName} — ` +
      "whether the mechanism even applies to the configured protocol.",
    inputSchema: {},
  },
  async () => {
    const applicable = PRESET.protocol === "aerodrome";
    return json({
      applicableToConfiguredProtocol: applicable,
      live: applicable && adapter.isLive(),
      mechanism:
        "Predictive Allocation: real-time incentive allocation based on predicted future demand, " +
        "replacing weekly veAERO gauge voting (Dromos Labs, announced for Aerodrome, launching September " +
        "2026 with the Aero merger). No equivalent mechanism has been announced for Velodrome.",
      currentPath: !applicable
        ? `This server is configured for ${PRESET.displayName}, which Predictive Allocation doesn't target. ` +
          "Use predict_demand + recommend_allocation for the demand signal, and prepare_vote_calldata for " +
          "the classic Voter.vote() flow."
        : adapter.isLive()
          ? "Direct submission available via prepare_submission."
          : "Contracts not yet published. Use predict_demand + recommend_allocation for the signal, and " +
            "prepare_vote_calldata for the classic Voter.vote() flow in the meantime.",
    });
  },
);

server.registerTool(
  "backtest_summary",
  {
    description:
      "Walk-forward validation of the demand forecast against real historical outcomes: replays " +
      "completed epochs, forecasts each using only data available at the time (same trailing window " +
      "predict_demand uses), and compares to a naive 'predict = last epoch' baseline. Reports error " +
      "metrics, skill vs. baseline, and whether confidence scores are actually calibrated. The " +
      "confidenceCalibration curve this produces is applied automatically to predict_demand, " +
      "recommend_allocation and recommend_bribe_placement's confidence scores (falling back to the " +
      "raw heuristic wherever backtest data is too sparse). Heavier than other tools (deep per-pool " +
      "history) — cached ~1h.",
    inputSchema: {
      refresh: z.boolean().default(false).describe("Force a fresh backtest run"),
      maxPools: z
        .number()
        .int()
        .min(5)
        .max(60)
        .optional()
        .describe("Pools to analyze; defaults to a smaller, faster set than predict_demand"),
    },
  },
  async ({ refresh, maxPools }) => {
    return json(await getBacktestReport({ force: refresh, maxPools }));
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("aero-allocator MCP server running on stdio");
