// Compares logged voter_roi recommendations (written by epoch-reminder,
// when AERO_VOTING_POWER is set) against what actually happened, for every
// logged epoch that has since completed. Run with: npm run realized-performance
import { getMarketSnapshot } from "../src/scoring.js";
import { computeRealizedPerformance } from "../src/tracking.js";
import { readRecommendationLog } from "../src/tracking-log.js";

const log = readRecommendationLog();
if (log.length === 0) {
  console.log(
    "No logged recommendations yet — data/voter-roi-log.jsonl is empty. Run epoch-reminder with " +
      "AERO_VOTING_POWER set (or wait for the scheduled workflow to) to start building a track record.",
  );
  process.exit(0);
}

console.log(`Building market snapshot (live Base RPC + DefiLlama prices)...`);
const snap = await getMarketSnapshot(true);

const results = computeRealizedPerformance(log, snap);
if (results.length === 0) {
  const pending = log.filter((e) => Date.now() / 1000 < e.epochStart + 7 * 24 * 60 * 60).length;
  console.log(
    `${log.length} logged recommendation(s), none completed yet (or their epoch's history has rolled off ` +
      `the live window — reconcile within a few weeks of each epoch). ${pending} still pending.`,
  );
  process.exit(0);
}

console.log(`\n${results.length} completed epoch(s) reconciled:\n`);
let sumExpected = 0;
let sumRealized = 0;
for (const r of results) {
  const date = new Date(r.epochStart * 1000).toISOString().slice(0, 10);
  sumExpected += r.totalExpectedRewardUsd;
  sumRealized += r.totalRealizedRewardUsd;
  console.log(
    `${date}  ${r.votingPowerVe.toLocaleString().padStart(8)} veAERO  ` +
      `predicted $${r.totalExpectedRewardUsd.toFixed(2).padStart(8)}  ` +
      `realized $${r.totalRealizedRewardUsd.toFixed(2).padStart(8)}  ` +
      `skill ${r.skillPct >= 0 ? "+" : ""}${r.skillPct.toFixed(1)}%`,
  );
  for (const p of r.pools) {
    const realized = p.realizedRewardUsd === null ? "n/a (rolled off history)" : `$${p.realizedRewardUsd.toFixed(2)}`;
    console.log(`    ${p.symbol.padEnd(30)} predicted $${p.expectedRewardUsd.toFixed(2).padStart(8)}  realized ${realized}`);
  }
}

const overallSkillPct = sumExpected > 0 ? ((sumRealized - sumExpected) / sumExpected) * 100 : 0;
console.log(
  `\nOverall: predicted $${sumExpected.toFixed(2)}, realized $${sumRealized.toFixed(2)} ` +
    `(${overallSkillPct >= 0 ? "+" : ""}${overallSkillPct.toFixed(1)}%)`,
);
console.log("(positive = your actual voter_roi reward beat what was predicted; negative = it fell short)");

// The RPC client's fallback transport (see data.ts) polls in the
// background to keep its health ranking current — harmless for a
// long-lived MCP server or serverless function, but it would otherwise
// keep this CLI script's event loop alive forever after it's done.
process.exit(0);
