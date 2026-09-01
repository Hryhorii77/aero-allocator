import {
  applyConfidenceCalibration,
  getMarketSnapshot,
  recommendAllocation,
  recommendLpDeposits,
  detectVoteSwings,
  type MarketSnapshot,
} from "aero-allocator/scoring";
import { getBacktestReport } from "aero-allocator/backtest";
import { getRewardTokenPriceUsd } from "aero-allocator/data";
import { currentEpochStart, epochProgress } from "aero-allocator/config";

/**
 * Snapshot with confidence recalibrated against backtested accuracy, when
 * available — mirrors the MCP server's calibratedSnapshot (src/index.ts) so
 * the dashboard's confidence bars match what the MCP tools report. Any
 * backtest fetch failure falls back to the raw heuristic confidence.
 */
export async function calibratedSnapshot(refresh = false): Promise<MarketSnapshot> {
  const [snap, calibration] = await Promise.all([
    getMarketSnapshot(refresh),
    getBacktestReport()
      .then((r) => r.confidenceCalibration)
      .catch(() => undefined),
  ]);
  return calibration ? applyConfidenceCalibration(snap, calibration) : snap;
}

/**
 * The full forecast payload: pools + all three allocation objectives + LP
 * yield + vote swings. Shared by the free dashboard (api/dashboard) and the
 * paid x402 endpoint (api/v1/forecast) — same computation, same one
 * snapshot build, just gated differently.
 */
export async function buildFullForecast(votingPower: number, refresh = false) {
  const [snap, rawSnap, rewardTokenPriceUsd] = await Promise.all([
    calibratedSnapshot(refresh),
    getMarketSnapshot(refresh),
    getRewardTokenPriceUsd(),
  ]);

  return {
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
  };
}
