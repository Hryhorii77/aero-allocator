// Pre-vote reminder: run a few hours before epoch flip (Thursday 00:00 UTC).
// Prints time-to-flip, the biggest predictive-edge mispricings (pools worth
// re-voting into or out of), and a protocol_efficiency allocation as a
// concrete reference split. Run with: npm run epoch-reminder
import { getMarketSnapshot, recommendAllocation } from "../src/scoring.js";
import { currentEpochStart, epochProgress, WEEK } from "../src/config.js";

const nextFlip = currentEpochStart() + WEEK;
const hoursLeft = (nextFlip - Date.now() / 1000) / 3600;

console.log(`Epoch ${(epochProgress() * 100).toFixed(1)}% elapsed — flips in ${hoursLeft.toFixed(1)}h`);
console.log("Building market snapshot (live Base RPC + DefiLlama prices)...\n");

const snap = await getMarketSnapshot(true);

const eligible = snap.forecasts.filter((f) => f.pool.gaugeAlive && f.confidence > 0);
const mispriced = [...eligible].sort((a, b) => Math.abs(b.predictiveEdge) - Math.abs(a.predictiveEdge)).slice(0, 8);

console.log("Biggest predictive-edge mispricings (predicted demand share vs current vote share):");
for (const f of mispriced) {
  const dir = f.predictiveEdge > 0 ? "under-incentivized" : "over-incentivized";
  console.log(
    `  ${f.pool.symbol.padEnd(38)} edge ${(f.predictiveEdge * 100).toFixed(2).padStart(6)}pp  (${dir})  ` +
      `pred $${Math.round(f.predictedFeesUsd).toLocaleString()}  conf ${f.confidence}`,
  );
}

const rec = recommendAllocation(snap, "protocol_efficiency", 8);
console.log(`\nReference allocation (protocol_efficiency): ${rec.summary}`);
for (const a of rec.allocations) {
  console.log(`  ${a.weightPct.toFixed(1).padStart(5)}%  ${a.symbol}`);
}
