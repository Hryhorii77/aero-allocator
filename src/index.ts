#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { encodeFunctionData, parseAbi } from "viem";
import { z } from "zod";
import { ADDRESSES } from "./config.js";
import { fetchEpochHistory, scanPools } from "./data.js";
import { getMarketSnapshot, recommendAllocation, summarizeHistory } from "./scoring.js";
import { adapter } from "./adapters/predictive-allocation.js";

const server = new McpServer({
  name: "aero-allocator",
  version: "0.1.0",
});

function json(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

function err(message: string) {
  return { content: [{ type: "text" as const, text: message }], isError: true };
}

server.registerTool(
  "scan_pools",
  {
    description:
      "Scan Aerodrome (Base) gauge-enabled pools with live TVL, staked TVL, fee tier and emissions. " +
      "Sorted by staked TVL. Use this for a market overview before predicting demand.",
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
      "Per-epoch history for one Aerodrome pool: votes, AERO emissions, trading fees (USD) and " +
      "bribes/incentives (USD) per weekly epoch, newest first (first row is the in-progress epoch).",
    inputSchema: {
      pool: z.string().regex(/^0x[0-9a-fA-F]{40}$/).describe("Pool (lp) address"),
      epochs: z.number().int().min(2).max(50).default(8),
    },
  },
  async ({ pool, epochs }) => {
    const history = await fetchEpochHistory(pool, epochs);
    if (history.length === 0) return err(`No epoch data found for ${pool}. Is it a gauge-enabled Aerodrome pool?`);
    return json(summarizeHistory(history));
  },
);

server.registerTool(
  "predict_demand",
  {
    description:
      "Forecast next-epoch trading-fee demand for top Aerodrome pools and compare it with current vote " +
      "allocation. Key output: predictiveEdgePct — pools with positive edge are under-incentivized " +
      "relative to predicted demand (the signal Predictive Allocation rewards). Data is cached ~5 min.",
    inputSchema: {
      limit: z.number().int().min(1).max(60).default(20).describe("Max pools to return"),
      sortBy: z.enum(["predicted_fees", "predictive_edge", "voter_roi"]).default("predicted_fees"),
      refresh: z.boolean().default(false).describe("Force a fresh onchain snapshot"),
    },
  },
  async ({ limit, sortBy, refresh }) => {
    const snap = await getMarketSnapshot(refresh);
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
      "Produce a concrete incentive-allocation recommendation across Aerodrome pools. " +
      "objective=protocol_efficiency allocates proportional to predicted next-epoch fee demand " +
      "(the Predictive Allocation ideal). objective=voter_roi maximizes the expected next-epoch reward " +
      "for votingPowerVe veAERO, accounting for self-dilution (your votes shrink the per-vote payout), " +
      "so pass the voter's real veAERO amount for sized weights. Returns weights that sum to 100%.",
    inputSchema: {
      objective: z.enum(["protocol_efficiency", "voter_roi"]).default("voter_roi"),
      maxPools: z.number().int().min(2).max(20).default(8),
      votingPowerVe: z
        .number()
        .min(1)
        .default(10000)
        .describe("veAERO voting power to allocate (voter_roi only)"),
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
    const snap = await getMarketSnapshot(refresh);
    return json(recommendAllocation(snap, objective, maxPools, votingPowerVe, maxWeightPct / 100));
  },
);

// Classic veAERO voting is live today; Predictive Allocation submission goes
// through the adapter once Dromos publishes contracts.
const voterAbi = parseAbi([
  "function vote(uint256 _tokenId, address[] _poolVote, uint256[] _weights)",
]);

server.registerTool(
  "prepare_vote_calldata",
  {
    description:
      "Build unsigned transaction calldata for Aerodrome Voter.vote() from an allocation " +
      "(veAERO NFT id + pool weights). Returns { to, data, value } for the host wallet " +
      "(e.g. Base MCP send/send_calls) to review, sign and submit — this server never signs. " +
      "Note: votes can only be cast once per epoch per veNFT, and not in the final hour before epoch flip.",
    inputSchema: {
      veNftId: z.number().int().min(1).describe("veAERO NFT token id that holds the voting power"),
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
      description: `Vote with veAERO #${veNftId} across ${allocations.length} pools: ${allocations
        .map((a) => `${a.weightPct}% → ${a.pool.slice(0, 10)}…`)
        .join(", ")}`,
      note: "Review pools and weights, then submit via your wallet (Base MCP send_calls) with user approval.",
    });
  },
);

server.registerTool(
  "predictive_allocation_status",
  {
    description:
      "Status of the direct Predictive Allocation submission path (Aerodrome's September 2026 mechanism " +
      "replacing weekly gauge voting). Reports whether live contracts are wired into this server.",
    inputSchema: {},
  },
  async () => {
    return json({
      live: adapter.isLive(),
      mechanism:
        "Predictive Allocation: real-time incentive allocation based on predicted future demand, " +
        "replacing weekly veAERO gauge voting (Dromos Labs, launching September 2026 with the Aero merger).",
      currentPath: adapter.isLive()
        ? "Direct submission available via prepare_submission."
        : "Contracts not yet published. Use predict_demand + recommend_allocation for the signal, and " +
          "prepare_vote_calldata for the classic Voter.vote() flow in the meantime.",
    });
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("aero-allocator MCP server running on stdio");
