// Walk-forward backtest against live Base data: replay completed epochs,
// forecast each with only the history available at the time, and score
// against realized fees and a naive "predict = last epoch" baseline.
// Run with: npm run backtest
import { getBacktestReport } from "../src/backtest.js";

const t0 = Date.now();
console.log("Building backtest report (live Base RPC + DefiLlama prices)...");

const report = await getBacktestReport({ force: true });
console.log(
  `Report built in ${((Date.now() - t0) / 1000).toFixed(1)}s — ` +
    `${report.poolsAnalyzed} pools, ${report.epochsWindow}-epoch history, ${report.samplePoints} forecast/actual pairs\n`,
);

const m = report.overall;
console.log("=== Overall ===");
console.log(`  MAE            $${m.mae.toLocaleString()}  (baseline $${m.baselineMae.toLocaleString()})`);
console.log(`  RMSE           $${m.rmse.toLocaleString()}`);
console.log(`  WAPE           ${(m.wape * 100).toFixed(1)}%  (baseline ${(m.baselineWape * 100).toFixed(1)}%)`);
console.log(`  Directional    ${m.directionalAccuracyPct.toFixed(1)}% correct`);
console.log(
  `  Skill vs. persistence baseline   MAE ${m.skillVsBaselineMaePct >= 0 ? "+" : ""}${m.skillVsBaselineMaePct.toFixed(1)}%` +
    `   WAPE ${m.skillVsBaselineWapePct >= 0 ? "+" : ""}${m.skillVsBaselineWapePct.toFixed(1)}%`,
);
console.log("  (positive skill = the model beats naively assuming next epoch repeats last epoch)");

console.log("\n=== Confidence calibration ===");
for (const b of report.byConfidence) {
  console.log(`  conf ${b.range.padEnd(11)} n=${String(b.n).padStart(4)}  MAE $${b.mae.toLocaleString().padStart(10)}  WAPE ${(b.wape * 100).toFixed(1)}%`);
}

console.log("\n=== Worst misses ===");
for (const w of report.worstMisses) {
  console.log(
    `  ${w.epoch}  ${w.symbol.padEnd(30)} pred $${w.predictedFeesUsd.toLocaleString().padStart(10)}  ` +
      `actual $${w.actualFeesUsd.toLocaleString().padStart(10)}  err $${w.absErrorUsd.toLocaleString()}`,
  );
}
