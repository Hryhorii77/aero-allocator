import { ImageResponse } from "next/og";
import { calibratedSnapshot } from "@/lib/snapshot";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { usd, formatCountdown, msUntilVoteLock } from "@/lib/format";
import { DISPLAY_PRESET } from "@/lib/protocol";
import { recommendAllocation } from "aero-allocator/scoring";
import { SETTINGS, currentEpochStart } from "aero-allocator/config";
import { headlineEstimate } from "@/lib/headline";

export const maxDuration = 60;

// The 1200×630 card people paste under a post: the number, what it's for, how
// long is left. Same recommendation the page shows (same snapshot, same
// voter_roi call, same 8-pool cap), so the image never disagrees with the
// screen it came from.
//
// The amount comes from ?vp= — a number the visitor chose to put in a link by
// pressing "share card", never something the page publishes on its own.
// Cached for a few minutes at the edge: the figure moves with the snapshot,
// not with every viewer, and a card being unfurled by a crowd shouldn't each
// cost a recommendation.
export async function GET(req: Request) {
  const limit = checkRateLimit(req, { key: "share", limit: 20, windowMs: 60_000 });
  if (!limit.allowed) return rateLimitResponse(limit.retryAfterSec);

  const raw = Number(new URL(req.url).searchParams.get("vp"));
  const votingPower = raw > 0 && raw <= 1_000_000_000 ? Math.round(raw) : 10_000;
  // Matches the page's theme when the link says so; anything else is dark.
  const light = new URL(req.url).searchParams.get("theme") === "light";
  const c = light
    ? { bg: "#fafaf9", text: "#404040", muted: "#737373", accent: "#0284c7", money: "#059669" }
    : { bg: "#0a0a0a", text: "#d4d4d4", muted: "#a3a3a3", accent: "#38bdf8", money: "#34d399" };

  try {
    const snap = await calibratedSnapshot(false);
    const rec = recommendAllocation(snap, "voter_roi", 8, votingPower);
    const forecastUsd = rec.allocations.reduce((s, a) => s + (a.expectedRewardUsd ?? 0), 0);
    // Same number the page leads with: when the forecast is far above what
    // these pools actually paid per vote last epoch, quote the realized rate
    // instead of the ceiling.
    const headline = headlineEstimate(rec.allocations, forecastUsd);
    const totalUsd = headline.headlineUsd;
    // To the vote lock (an hour before the flip): the last moment a vote can land.
    const closeMs = msUntilVoteLock(currentEpochStart());
    const pools = rec.allocations.length;

    return new ImageResponse(
      (
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            background: c.bg,
            padding: "64px 72px",
            color: c.text,
          }}
        >
          <div style={{ display: "flex", fontSize: 36, color: c.muted }}>
            {DISPLAY_PRESET.appName.replace(/ Allocator$/, "")}&nbsp;<span style={{ color: c.accent }}>Allocator</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", fontSize: 200, lineHeight: 1, color: c.money, fontWeight: 700 }}>
              {usd(totalUsd)}
            </div>
            <div style={{ display: "flex", fontSize: 44, marginTop: 20, color: c.text }}>
              {headline.forecastIsUpperBound ? "at last epoch's rate" : "expected next epoch"} — your voter $, not pool fees
            </div>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 34, color: c.muted }}>
            <div style={{ display: "flex" }}>
              {votingPower.toLocaleString("en-US")} {DISPLAY_PRESET.veTokenSymbol} · {pools} pool
              {pools === 1 ? "" : "s"} · {closeMs > 0 ? `votes close in ${formatCountdown(closeMs)}` : "voting closed"}
            </div>
            <div style={{ display: "flex", color: c.accent }}>aeroallocator.app</div>
          </div>
        </div>
      ),
      {
        width: 1200,
        height: 630,
        headers: { "Cache-Control": `public, s-maxage=${Math.round(SETTINGS.cacheTtlMs / 1000)}, stale-while-revalidate=600` },
      },
    );
  } catch (e) {
    console.error(
      JSON.stringify({ level: "error", route: "share", message: e instanceof Error ? e.message : String(e) }),
    );
    return new Response("Failed to generate the card", { status: 500 });
  }
}
