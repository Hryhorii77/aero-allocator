// Sizes the addressable market from chain instead of guessing it.
//
// For every veNFT at or above a size threshold: read its current on-chain
// vote split, run the voter_roi recommendation at that lock's own size
// (dilution is size-dependent, so one shared recommendation would be wrong
// for everyone), and price the difference. Output is a dollar-ranked list of
// every locker with the amount their current split leaves on the table.
//
// Run with: npm run lockers -- [--min 50000] [--top 40] [--json out.json]
//                            [--max-id N] [--concurrency 4]
//
// This answers a question that both of the monetization memos guessed at:
// whether anyone has enough at stake to pay for a better split. If the top
// lockers' aggregate weekly upside is small, no pricing tier works and the
// finding is worth more than the feature would have been.
import { writeFileSync } from "node:fs";
import { getMarketSnapshot, recommendAllocation } from "../src/scoring.js";
import { fetchLockers } from "../src/lockers.js";
import { computePositionDelta, type PoolRate } from "../src/position.js";

// Same maxPools the dashboard uses (web/lib/snapshot.ts) — this list has to
// price the split a locker would actually be shown, not a different one.
const MAX_POOLS = 8;

function arg(flag: string, fallback: string): string {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const minVotingPower = Number(arg("--min", "50000"));
const topN = Number(arg("--top", "40"));
const jsonPath = arg("--json", "");
// A full census is ~2,600 pages of 50 full VeNFT structs — hundreds of MB of
// eth_call responses, which a public RPC throttles to a crawl (measured:
// roughly 9 pages/min, so several hours). --max-id bounds the sweep to the
// first N token ids for a fast, partial answer; the output labels coverage so
// a partial run can't be mistaken for a census. A dedicated RPC makes the
// full run practical.
const maxIdArg = Number(arg("--max-id", "0"));
const concurrency = Number(arg("--concurrency", "4"));

const usd = (n: number) => `$${n.toFixed(2)}`;
const pad = (s: string, n: number) => s.padStart(n);

console.log(`Building market snapshot (live Base RPC + DefiLlama prices)...`);
const snap = await getMarketSnapshot(true);

// Every pool's last-epoch $/1k rate, the basis the "stay" side is priced on.
const poolRates = new Map<string, PoolRate>(
  snap.forecasts.map((f) => [
    f.pool.lp.toLowerCase(),
    { symbol: f.pool.symbol, rewardPer1kVotesUsd: f.rewardPer1kVotesUsd },
  ]),
);

console.log(`Sweeping veNFTs for locks >= ${minVotingPower.toLocaleString()} veAERO (this takes a few minutes)...`);
let lastPrint = 0;
const scan = await fetchLockers({
  minVotingPower,
  concurrency,
  ...(maxIdArg > 0 ? { maxTokenId: maxIdArg } : {}),
  onProgress: (done, total, found) => {
    // Throttled: one line per ~2% so the log stays readable but a stalled
    // sweep is still obviously stalled.
    const pct = Math.floor((done / total) * 50);
    if (pct > lastPrint) {
      lastPrint = pct;
      process.stdout.write(`\r  ${done}/${total} pages · ${found} qualifying locks found`);
    }
  },
});
process.stdout.write("\n");

if (scan.failedOffsets.length > 0) {
  console.log(
    `WARNING: ${scan.failedOffsets.length} id window(s) never returned — these results UNDERCOUNT. ` +
      `Re-run before trusting the totals.`,
  );
}

const partial = maxIdArg > 0;
console.log(
  `Scanned ids 1..${scan.maxTokenId.toLocaleString()} · ${scan.lockers.length} locks at or above threshold` +
    (partial ? ` — PARTIAL (--max-id ${maxIdArg.toLocaleString()}), not a census` : "") +
    "\n",
);

if (scan.lockers.length === 0) {
  console.log("No locks above the threshold. Lower --min.");
  process.exit(0);
}

type Priced = {
  tokenId: string;
  account: string;
  votingPower: number;
  hasVoted: boolean;
  comparable: boolean;
  stayUsd: number;
  switchUsd: number;
  deltaUsd: number;
  currentPoolCount: number;
};

const priced: Priced[] = [];
for (const l of scan.lockers) {
  // Re-run the recommendation at this lock's own size: the water-fill
  // allocator self-dilutes, so a 2M veAERO lock and a 60k one get genuinely
  // different splits and different expected payouts. Reusing one shared
  // recommendation would overstate the big lockers badly — which are exactly
  // the ones this list is for.
  const rec = recommendAllocation(snap, "voter_roi", MAX_POOLS, l.votingPower);
  const d = computePositionDelta({
    currentVotes: l.votes,
    votingPower: l.votingPower,
    recommended: rec.allocations,
    poolRates,
  });
  priced.push({
    tokenId: l.tokenId,
    account: l.account,
    votingPower: l.votingPower,
    hasVoted: d.hasVoted,
    comparable: d.comparable,
    stayUsd: d.estimateIfStayUsd,
    switchUsd: d.estimateIfSwitchUsd,
    deltaUsd: d.deltaUsd,
    currentPoolCount: d.currentPoolCount,
  });
}

// Only locks we can honestly price make the ranked list: an unvoted lock has
// no "stay" side at all, and an incomparable one is missing a held pool's
// rate, which would flatter switching by exactly the unmeasured amount.
const rankable = priced.filter((p) => p.hasVoted && p.comparable).sort((a, b) => b.deltaUsd - a.deltaUsd);
const unvoted = priced.filter((p) => !p.hasVoted);
const unpriceable = priced.filter((p) => p.hasVoted && !p.comparable);

console.log(`Top ${Math.min(topN, rankable.length)} by dollars left on the table (per epoch):\n`);
console.log(`  ${pad("tokenId", 8)} ${pad("veAERO", 12)} ${pad("stay", 10)} ${pad("switch", 10)} ${pad("delta", 10)}  pools  account`);
for (const p of rankable.slice(0, topN)) {
  console.log(
    `  ${pad(p.tokenId, 8)} ${pad(Math.round(p.votingPower).toLocaleString(), 12)} ` +
      `${pad(usd(p.stayUsd), 10)} ${pad(usd(p.switchUsd), 10)} ` +
      `${pad((p.deltaUsd >= 0 ? "+" : "") + usd(p.deltaUsd), 10)}  ${pad(String(p.currentPoolCount), 5)}  ${p.account}`,
  );
}

const positive = rankable.filter((p) => p.deltaUsd > 0);
const upsideSum = positive.reduce((s, p) => s + p.deltaUsd, 0);
const veSum = scan.lockers.reduce((s, l) => s + l.votingPower, 0);

console.log(`\n--- market size ---`);
if (partial) {
  // Said before the numbers, not after: a truncated sweep undercounts every
  // figure below, and a reader who skims the table should not walk away with
  // a census in their head.
  console.log(`  COVERAGE: ids 1..${maxIdArg.toLocaleString()} only — every figure below is a LOWER BOUND.`);
}
console.log(`  locks >= ${minVotingPower.toLocaleString()} veAERO : ${scan.lockers.length}`);
console.log(`  of those, voted this epoch      : ${rankable.length + unpriceable.length}`);
console.log(`  ...priceable                    : ${rankable.length}`);
console.log(`  ...holding an unpriced pool     : ${unpriceable.length} (excluded — would flatter switching)`);
console.log(`  not voted at all                : ${unvoted.length}`);
console.log(`  combined voting power           : ${Math.round(veSum).toLocaleString()} veAERO`);
console.log(`  locks with positive upside      : ${positive.length}`);
console.log(`  SUM of positive upside / epoch  : ${usd(upsideSum)}`);
console.log(`  median positive upside / epoch  : ${usd(positive.length ? positive[Math.floor(positive.length / 2)].deltaUsd : 0)}`);

// The number above is an upper bound and must never be quoted without this.
// Each individual delta already accounts for the *recommendation's* own
// self-dilution, but not for the other lockers in this same list moving too:
// if they all rotated into the same pools, the edge that makes the delta
// positive would largely close. Treat the sum as "the prize if you are the
// only one who acts", which is also roughly what it's worth to any one
// subscriber — not as revenue, and not as a market that can be harvested in
// aggregate.
console.log(
  `\n  NOTE: that sum assumes each locker is the only one who moves. They share\n` +
    `  the same recommended pools, so if all of them rotated the edge would\n` +
    `  largely close. It is an upper bound on the prize, not a revenue figure.`,
);

if (jsonPath) {
  writeFileSync(jsonPath, JSON.stringify({ generatedAt: new Date().toISOString(), minVotingPower, scan: { maxTokenId: scan.maxTokenId, failedOffsets: scan.failedOffsets }, lockers: rankable }, null, 2));
  console.log(`\nWrote ${rankable.length} priced locks to ${jsonPath}`);
}
