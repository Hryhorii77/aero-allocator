// Pre-vote reminder: run a few hours before epoch flip (Thursday 00:00 UTC).
// Prints time-to-flip, the biggest predictive-edge mispricings (pools worth
// re-voting into or out of), any pools where bribes/votes are running well
// off their normal pace (the "incentivized pool draining regular pools
// right before lock" pattern), and a protocol_efficiency allocation as a
// concrete reference split. Run with: npm run epoch-reminder
//
// If AERO_DISCORD_WEBHOOK_URL is set, also posts the same summary to Discord
// — see .github/workflows/epoch-reminder.yml for the scheduled version that
// fires a few times in the final hours before each epoch's lock, so this is
// actionable without anyone polling for it.
//
// If AERO_VOTING_POWER is also set, the Discord post includes your personal
// voter_roi split (not just the market-wide protocol_efficiency reference)
// — and if AERO_DASHBOARD_URL is set too, a one-click link straight into
// the dashboard with that allocation pre-loaded (via the ?vp= URL param),
// wallet-connect ready. This is deliberately "prepare + one-click approve,"
// not unattended signing: no private key is ever held by this script or
// any server — you still connect your own wallet and confirm.
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

const votingPower = Number(process.env.AERO_VOTING_POWER);
const myVote = votingPower > 0 ? recommendAllocation(snap, "voter_roi", 8, votingPower) : null;
if (myVote) {
  console.log(`\nYour vote (${votingPower.toLocaleString()} veAERO): ${myVote.summary}`);
  for (const a of myVote.allocations) {
    console.log(`  ${a.weightPct.toFixed(1).padStart(5)}%  ${a.symbol}`);
  }
}

const dashboardUrl = process.env.AERO_DASHBOARD_URL;
const voteLink = myVote && dashboardUrl ? `${dashboardUrl.replace(/\/$/, "")}/?vp=${votingPower}` : null;

const webhookUrl = process.env.AERO_DISCORD_WEBHOOK_URL;
if (webhookUrl) {
  const urgent = hoursLeft <= 6;
  const fields = [
    {
      name: "Biggest mispricings",
      value: mispriced
        .slice(0, 5)
        .map((f) => {
          const dir = f.predictiveEdge > 0 ? "under-incentivized" : "over-incentivized";
          return `**${f.pool.symbol}** ${f.predictiveEdge > 0 ? "+" : ""}${(f.predictiveEdge * 100).toFixed(2)}pp (${dir})`;
        })
        .join("\n"),
    },
    ...(swings.risers.length > 0
      ? [
          {
            name: "Bribes running ahead of pace",
            value: swings.risers
              .slice(0, 3)
              .map((r) => `**${r.symbol}** ${r.bribeSpikeRatio === null ? "new bribe" : `${r.bribeSpikeRatio}x pace`}`)
              .join("\n"),
          },
        ]
      : []),
    ...(swings.fallers.length > 0
      ? [
          {
            name: "Votes running behind pace",
            value: swings.fallers.slice(0, 3).map((f) => `**${f.symbol}** ${f.voteSwingPct}%`).join("\n"),
          },
        ]
      : []),
    {
      name: "Reference allocation (protocol_efficiency)",
      value: rec.allocations
        .slice(0, 5)
        .map((a) => `${a.weightPct.toFixed(1)}% ${a.symbol}`)
        .join("\n"),
    },
    ...(myVote
      ? [
          {
            name: `Your vote (${votingPower.toLocaleString()} veAERO)${voteLink ? " — click below to approve" : ""}`,
            value: myVote.allocations.map((a) => `${a.weightPct.toFixed(1)}% ${a.symbol}`).join("\n"),
          },
        ]
      : []),
  ];

  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        embeds: [
          {
            title: `Aero Allocator — epoch flips in ${hoursLeft.toFixed(1)}h`,
            url: voteLink ?? undefined,
            description:
              `${(epochProgress() * 100).toFixed(1)}% of the current epoch elapsed. Vote lock is the final hour ` +
              `before Thursday 00:00 UTC.` +
              (voteLink ? `\n\n**[Open dashboard with your vote pre-loaded](${voteLink})** — connect your wallet and click "cast vote" to approve.` : ""),
            color: urgent ? 0xe74c3c : 0xf39c12,
            fields,
          },
        ],
      }),
    });
    if (!res.ok) {
      console.error(`\nDiscord webhook failed: HTTP ${res.status} ${await res.text()}`);
    } else {
      console.log("\nPosted summary to Discord.");
    }
  } catch (e) {
    console.error(`\nDiscord webhook failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}
