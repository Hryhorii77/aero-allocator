import {
  applyConfidenceCalibration,
  getMarketSnapshot,
  recommendAllocation,
  recommendLpDeposits,
  detectVoteSwings,
  type MarketSnapshot,
} from "aero-allocator/scoring";
import { getBacktestReport, type BacktestReport } from "aero-allocator/backtest";
import { getRewardTokenPriceUsd } from "aero-allocator/data";
import { currentEpochStart, epochProgress } from "aero-allocator/config";

/**
 * Compact track-record summary for the dashboard's "forecast accuracy"
 * panel — trims getBacktestReport's full output (worst-misses list,
 * per-point data) down to what's worth showing a visitor deciding whether
 * to trust these forecasts. Mixed units in the source report (backtest.ts):
 * `wape` is a raw fraction (0..1, needs ×100), while anything already
 * named "...Pct" (directionalAccuracyPct, skillVsBaselineWapePct) is
 * already a percentage — same convention the CLI backtest script relies on.
 */
export function summarizeBacktest(report: BacktestReport) {
  return {
    epochsWindow: report.epochsWindow,
    poolsAnalyzed: report.poolsAnalyzed,
    samplePoints: report.samplePoints,
    overall: {
      maeUsd: Math.round(report.overall.mae),
      wapePct: Math.round(report.overall.wape * 1000) / 10,
      directionalAccuracyPct: Math.round(report.overall.directionalAccuracyPct * 10) / 10,
      skillVsBaselineWapePct: Math.round(report.overall.skillVsBaselineWapePct * 10) / 10,
    },
    byConfidence: report.byConfidence.map((b) => ({
      range: b.range,
      n: b.n,
      wapePct: Math.round(b.wape * 1000) / 10,
    })),
    methodology: report.methodology,
  };
}
export type BacktestSummary = ReturnType<typeof summarizeBacktest>;

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
  // getMarketSnapshot(refresh) fetched once and reused for both the
  // calibrated and raw views — calling calibratedSnapshot(refresh) here too
  // (as this used to) would independently re-invoke getMarketSnapshot with
  // force=true, which bypasses the cache-check unconditionally and starts a
  // second full RPC scan + DefiLlama price fetch in parallel with this one,
  // doubling load on every `refresh=1` request for no benefit (same data).
  const [rawSnap, backtestReport, rewardTokenPriceUsd] = await Promise.all([
    getMarketSnapshot(refresh),
    // Full report, not just .confidenceCalibration — also feeds the
    // dashboard's track-record panel below. getBacktestReport has its own
    // ~1h cache (see backtest.ts), so this costs nothing extra beyond what
    // calibratedSnapshot already paid for confidence recalibration.
    getBacktestReport().catch(() => null),
    getRewardTokenPriceUsd(),
  ]);
  const snap = backtestReport ? applyConfidenceCalibration(rawSnap, backtestReport.confidenceCalibration) : rawSnap;

  return {
    trackRecord: backtestReport ? summarizeBacktest(backtestReport) : null,
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
