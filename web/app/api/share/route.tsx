import { ImageResponse } from "next/og";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { usd } from "@/lib/format";
import { DISPLAY_PRESET } from "@/lib/protocol";
import { gaugeLabel, getGauges } from "@/lib/gauges";
import { getGaugeFees } from "@/lib/gauge-fees-read";
import { rankByUsdPerDay } from "@/lib/gauge-yield";
import { bestSplit } from "@/lib/split";
import { BASE_CHAIN } from "@/lib/aero-chains";
import { shareAmount } from "@/lib/share-amount";

export const maxDuration = 60;

// The 1200×630 card people paste under a post: what an amount of sAERO earns per day in the best split of Base gauges, from the
// same gauge and fee reads as the page.
//
// The amount comes from ?vp= — a number the visitor chose to put in a link by pressing "share card", never something the page
// publishes on its own. Cached for a few minutes at the edge: the figure moves with the fee reads, not with every viewer, and a
// card being unfurled by a crowd shouldn't each cost a gauge scan. When the data can't be read the card still renders, without
// a number, so a preview never shows a $0 or an error.
type Palette = { bg: string; text: string; muted: string; accent: string; money: string };

function card(c: Palette, big: string, sub: string, foot: string, maxAge: number) {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", background: c.bg, padding: "64px 72px", color: c.text }}>
        <div style={{ display: "flex", fontSize: 36, color: c.muted }}>
          {DISPLAY_PRESET.appName.replace(/ Allocator$/, "")}&nbsp;<span style={{ color: c.accent }}>Allocator</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", fontSize: 200, lineHeight: 1, color: c.money, fontWeight: 700 }}>{big}</div>
          <div style={{ display: "flex", fontSize: 44, marginTop: 20, color: c.text }}>{sub}</div>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 34, color: c.muted }}>
          <div style={{ display: "flex" }}>{foot}</div>
          <div style={{ display: "flex", color: c.accent }}>aeroallocator.app</div>
        </div>
      </div>
    ),
    { width: 1200, height: 630, headers: { "Cache-Control": `public, s-maxage=${maxAge}, stale-while-revalidate=600` } },
  );
}

async function saeroCard(c: Palette, amount: number) {
  const [list, fees] = await Promise.all([getGauges(BASE_CHAIN.id), getGaugeFees(BASE_CHAIN.id)]);
  const ranked = rankByUsdPerDay(list.gauges, fees.fees, amount);
  const split = bestSplit(ranked.map((r) => ({ gauge: r.gauge, symbol: gaugeLabel(r), rate: r.feesUsdPerDay + r.incentivesUsdPerDay, weight: r.weight })), amount);
  const sAero = `${amount.toLocaleString("en-US")} sAERO`;
  if (!split) return noNumberCard(c, 300);
  // Two named gauges at most: the pool kind ("CL100") makes each name longer, and the footer line must not run into the site name.
  const where = split.parts.slice(0, 2).map((p) => `${p.symbol} ${Math.round(p.pct)}%`).join(" · ");
  return card(c, usd(split.usdPerDay), `per day, best split of ${sAero} on Base`, where, 300);
}

/** The card with no number: used when there is nothing to rank or the reads failed. Short cache so it heals quickly. */
const noNumberCard = (c: Palette, maxAge: number) => card(c, "sAERO", "Where your sAERO earns the most on Aero", "gauges ranked by what your amount earns per day", maxAge);

export async function GET(req: Request) {
  const limit = checkRateLimit(req, { key: "share", limit: 20, windowMs: 60_000 });
  if (!limit.allowed) return rateLimitResponse(limit.retryAfterSec);

  const params = new URL(req.url).searchParams;
  const amount = shareAmount(params.get("vp"));
  // Matches the page's theme when the link says so; anything else is dark.
  const c: Palette =
    params.get("theme") === "light"
      ? { bg: "#fafaf9", text: "#404040", muted: "#737373", accent: "#0284c7", money: "#059669" }
      : { bg: "#0a0a0a", text: "#d4d4d4", muted: "#a3a3a3", accent: "#38bdf8", money: "#34d399" };

  try {
    return await saeroCard(c, amount);
  } catch (e) {
    console.error(JSON.stringify({ level: "error", route: "share", message: e instanceof Error ? e.message : String(e) }));
    return noNumberCard(c, 60);
  }
}
