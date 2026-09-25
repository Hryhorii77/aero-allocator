// Mid-week vote alert: run on a timer (see .github/workflows/vote-alerts.yml),
// compares the pools in your voter_roi split against the last run, and posts
// to Discord only when one of them took >= 2x its votes or its edge flipped
// sign — the moments worth leaving what you're doing for. Silent otherwise.
//
// Reads the deployed dashboard's /api/dashboard instead of scanning the chain
// itself: that route is served from the shared snapshot cache in seconds,
// where a fresh scan from a CI runner is minutes of RPC for the same numbers.
//
// Env:
//   AERO_DASHBOARD_URL          required — e.g. https://aeroallocator.app
//   AERO_VOTING_POWER           your veAERO amount (default 10000) — sizes the split being watched
//   AERO_DISCORD_WEBHOOK_URL    optional — without it, alerts are only printed (a dry run)
//   AERO_ALERT_STATE_PATH       where the last reading is kept (default data/vote-alert-state.json)
//   AERO_ALERT_MIN_VOTES        smallest vote growth that can alert (default 10000)
//   AERO_ALERT_TEST=true        send one "connected" line to Discord and stop — checks the webhook
//                               without waiting for a real event; fails loudly if it isn't set,
//                               and leaves the saved reading alone
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { alertStateFromDashboard, detectAlerts, type AlertState } from "../src/alerts.js";

const dashboardUrl = process.env.AERO_DASHBOARD_URL?.replace(/\/$/, "");
if (!dashboardUrl) {
  console.error("Set AERO_DASHBOARD_URL to the dashboard's address (e.g. https://aeroallocator.app).");
  process.exit(1);
}
const votingPower = Number(process.env.AERO_VOTING_POWER) > 0 ? Number(process.env.AERO_VOTING_POWER) : 10_000;
const statePath = process.env.AERO_ALERT_STATE_PATH ?? "data/vote-alert-state.json";
const minVoteIncrease = Number(process.env.AERO_ALERT_MIN_VOTES) > 0 ? Number(process.env.AERO_ALERT_MIN_VOTES) : undefined;

if (process.env.AERO_ALERT_TEST === "true") {
  const hook = process.env.AERO_DISCORD_WEBHOOK_URL;
  if (!hook) {
    console.error("Test failed: AERO_DISCORD_WEBHOOK_URL isn't set, so there's nowhere to send it.");
    process.exit(1);
  }
  try {
    const post = await fetch(hook, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        content: `✅ Aero Allocator vote alerts are connected. Watching the ${votingPower.toLocaleString()} veAERO split on ${dashboardUrl}. You'll only hear from me when a pool in it takes 2x its votes or its edge flips.`,
      }),
    });
    if (!post.ok) {
      console.error(`Test failed: Discord answered HTTP ${post.status} ${await post.text()}`);
      process.exit(1);
    }
    console.log("Test message sent to Discord.");
    process.exit(0);
  } catch (e) {
    console.error(`Test failed: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }
}

function readState(): AlertState | null {
  if (!existsSync(statePath)) return null;
  try {
    return JSON.parse(readFileSync(statePath, "utf8"));
  } catch {
    return null; // a corrupt state file just means "no earlier reading"
  }
}

const res = await fetch(`${dashboardUrl}/api/dashboard?votingPower=${votingPower}`);
if (!res.ok) {
  // Leave the saved state alone: comparing against the last good reading next run beats comparing against nothing.
  console.error(`dashboard: HTTP ${res.status} ${await res.text()}`);
  process.exit(1);
}
const curr = alertStateFromDashboard(await res.json());
const prev = readState();
const alerts = detectAlerts(prev, curr, { minVoteIncrease });

console.log(
  `Watching ${curr.pools.length} pools in the ${votingPower.toLocaleString()} veAERO split` +
    (prev ? ` (last reading ${prev.takenAt}${prev.epochStart !== curr.epochStart ? ", earlier epoch — no comparison" : ""})` : " (first reading)") +
    `: ${alerts.length} alert${alerts.length === 1 ? "" : "s"}.`,
);
for (const a of alerts) console.log(`  - ${a.text}`);

let delivered = true;
const webhookUrl = process.env.AERO_DISCORD_WEBHOOK_URL;
if (alerts.length > 0 && webhookUrl) {
  try {
    const post = await fetch(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        embeds: [
          {
            title: "Aero Allocator — your split just moved",
            url: `${dashboardUrl}/?vp=${votingPower}`,
            description: alerts.map((a) => `• ${a.text}`).join("\n") + `\n\n**[Re-check your split](${dashboardUrl}/?vp=${votingPower})**`,
            color: 0xf39c12,
          },
        ],
      }),
    });
    if (!post.ok) {
      delivered = false;
      console.error(`Discord webhook failed: HTTP ${post.status} ${await post.text()}`);
    } else {
      console.log("Posted to Discord.");
    }
  } catch (e) {
    delivered = false;
    console.error(`Discord webhook failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

// Keep the old reading if an alert failed to send, so the next run can raise it again.
if (delivered) {
  mkdirSync(dirname(statePath), { recursive: true });
  writeFileSync(statePath, JSON.stringify(curr, null, 2) + "\n", "utf8");
}
process.exit(delivered ? 0 : 1);
