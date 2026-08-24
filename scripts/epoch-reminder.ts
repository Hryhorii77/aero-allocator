// Pre-vote reminder: run a few hours before epoch flip (Thursday 00:00 UTC).
// Prints time-to-flip, the biggest predictive-edge mispricings (pools worth
// re-voting into or out of), any pools where bribes/votes are running well
// off their normal pace (the "incentivized pool draining regular pools
// right before lock" pattern), and a protocol_efficiency allocation as a
// concrete reference split. Run with: npm run epoch-reminder
import { detectVoteSwings, getMarketSnapshot, recommendAllocation } from "../src/scoring.js";
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

const swings = detectVoteSwings(snap, { maxPools: 5 });
if (swings.risers.length > 0) {
  console.log("\nBribes running ahead of pace (early signal — votes often follow):");
  for (const r of swings.risers) {
    console.log(
      `  ${r.symbol.padEnd(38)} ${r.bribeSpikeRatio === null ? "new bribe" : `${r.bribeSpikeRatio}x pace`}  ` +
        `$${r.currentBribesUsd.toLocaleString()} bribes so far  votes ${r.voteSwingPct >= 0 ? "+" : ""}${r.voteSwingPct}%`,
    );
  }
}
if (swings.fallers.length > 0) {
  console.log("\nVotes running behind pace (likely drained toward a riser above):");
  for (const f of swings.fallers) {
    console.log(`  ${f.symbol.padEnd(38)} votes ${f.voteSwingPct}% vs normal trajectory`);
  }
}

const rec = recommendAllocation(snap, "protocol_efficiency", 8);
console.log(`\nReference allocation (protocol_efficiency): ${rec.summary}`);
for (const a of rec.allocations) {
  console.log(`  ${a.weightPct.toFixed(1).padStart(5)}%  ${a.symbol}`);
}
