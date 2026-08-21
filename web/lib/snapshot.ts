import { applyConfidenceCalibration, getMarketSnapshot, type MarketSnapshot } from "aero-allocator/scoring";
import { getBacktestReport } from "aero-allocator/backtest";

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
