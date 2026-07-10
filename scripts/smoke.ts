// End-to-end smoke test against live Base data: scan pools, build forecasts,
// print both allocation objectives. Run with: npm run smoke
import { getMarketSnapshot, recommendAllocation } from "../src/scoring.js";
import { epochProgress } from "../src/config.js";

const t0 = Date.now();
console.log(`Epoch progress: ${(epochProgress() * 100).toFixed(1)}%`);
console.log("Building market snapshot (live Base RPC + DefiLlama prices)...");

const snap = await getMarketSnapshot(true);
console.log(`Snapshot built in ${((Date.now() - t0) / 1000).toFixed(1)}s — ${snap.forecasts.length} pools analyzed\n`);

console.log("Top 10 by predicted next-epoch fees:");
for (const f of snap.forecasts.slice(0, 10)) {
  console.log(
    `  ${f.pool.symbol.padEnd(38)} pred $${Math.round(f.predictedFeesUsd).toLocaleString().padStart(10)}  ` +
      `last $${Math.round(f.lastEpochFeesUsd).toLocaleString().padStart(10)}  ` +
      `edge ${(f.predictiveEdge * 100).toFixed(2).padStart(6)}pp  ` +
      `$${f.rewardPer1kVotesUsd}/1k votes  conf ${f.confidence}`,
  );
}

for (const objective of ["voter_roi", "protocol_efficiency"] as const) {
  const rec = recommendAllocation(snap, objective, 8, 100_000);
  console.log(`\n=== ${objective} ===`);
  console.log(rec.summary);
  for (const a of rec.allocations) {
    console.log(`  ${a.weightPct.toFixed(1).padStart(5)}%  ${a.symbol.padEnd(38)} ${a.rationale}`);
  }
}
