import { NextResponse } from "next/server";
import { getMarketSnapshot, recommendAllocation, recommendLpDeposits, detectVoteSwings } from "aero-allocator/scoring";
import { getRewardTokenPriceUsd } from "aero-allocator/data";
import { currentEpochStart, epochProgress } from "aero-allocator/config";
import { calibratedSnapshot } from "@/lib/snapshot";

// 60s is the ceiling on Vercel's Hobby plan; raise if on Pro/Enterprise and
// a cold build (up to ~1min with the default AERO_MAX_CANDIDATES) still hits it.
export const maxDuration = 60;

// Consolidates what the dashboard needs on load into one function
// invocation. Each app/api/*/route.ts file is its own separate serverless
// function on Vercel — hitting six of them in parallel (as the previous
// snapshot/allocation x3/lp-deposit/vote-swings split did) meant up to six
// independent cold snapshot builds (and six times the RPC load) per page
// view, since there's no shared memory between them. Building the snapshot
// once here and reusing it for every panel keeps that to one.
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const refresh = params.get("refresh") === "1";
  const votingPower = Math.max(1, Number(params.get("votingPower") ?? 10000) || 10000);

  const [snap, rawSnap, rewardTokenPriceUsd] = await Promise.all([
    calibratedSnapshot(refresh),
    getMarketSnapshot(refresh),
    getRewardTokenPriceUsd(),
  ]);

  return NextResponse.json({
    generatedAt: snap.generatedAt,
    epochStart: currentEpochStart(),
    epochProgressPct: Math.round(epochProgress() * 1000) / 10,
    pools: snap.forecasts.map((f) => ({
      lp: f.pool.lp,
      symbol: f.pool.symbol,
      poolType: f.pool.poolType,
      tvlUsd: Math.round(f.pool.tvlUsd),
      predictedFeesUsd: f.predictedFeesUsd,
      lastEpochFeesUsd: f.lastEpochFeesUsd,
      feeTrendUsdPerEpoch: f.feeTrendUsdPerEpoch,
      currentBribesUsd: f.currentBribesUsd,
      voteSharePct: Math.round(f.voteShare * 10000) / 100,
      demandSharePct: Math.round(f.predictedDemandShare * 10000) / 100,
      edgePct: Math.round(f.predictiveEdge * 10000) / 100,
      rewardPer1kVotesUsd: f.rewardPer1kVotesUsd,
      confidence: f.confidence,
    })),
    voterAlloc: recommendAllocation(snap, "voter_roi", 8, votingPower),
    protoAlloc: recommendAllocation(snap, "protocol_efficiency", 8),
    edgeAlloc: recommendAllocation(snap, "edge_hunter", 8),
    lpDeposits: recommendLpDeposits(rawSnap, rewardTokenPriceUsd, { maxPools: 15 }),
    voteSwings: detectVoteSwings(rawSnap, { maxPools: 8 }),
  });
}
