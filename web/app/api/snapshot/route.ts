import { NextResponse } from "next/server";
import { currentEpochStart, epochProgress } from "aero-allocator/config";
import { calibratedSnapshot } from "@/lib/snapshot";
import { withApiErrorHandling } from "@/lib/api-error";

export const GET = withApiErrorHandling("snapshot", async (req: Request) => {
  const refresh = new URL(req.url).searchParams.get("refresh") === "1";
  const snap = await calibratedSnapshot(refresh);
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
  });
});
