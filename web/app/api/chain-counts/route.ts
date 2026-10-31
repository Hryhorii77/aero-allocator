import { NextResponse } from "next/server";
import { AERO_CHAINS } from "@/lib/aero-chains";
import { withApiErrorHandling } from "@/lib/api-error";
import { rankableCount, type ChainCount } from "@/lib/chain-counts";
import { getGauges } from "@/lib/gauges";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";

export const maxDuration = 60;

/**
 * Read-only: the number on each chain button, so the page doesn't download seven gauge lists to show it. A chain that can't be read is left
 * out (its button shows no number) instead of failing the rest.
 */
export const GET = withApiErrorHandling("chain-counts", async (req: Request) => {
  const rl = checkRateLimit(req, { key: "chain-counts", limit: 30, windowMs: 60_000 });
  if (!rl.allowed) return rateLimitResponse(rl.retryAfterSec);
  const lists = await Promise.allSettled(AERO_CHAINS.map((c) => getGauges(c.id)));
  const counts: ChainCount[] = lists.flatMap((r, i) => (r.status === "fulfilled" ? [{ chainId: AERO_CHAINS[i].id, ranked: rankableCount(r.value.gauges) }] : []));
  return NextResponse.json({ counts }, { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" } });
});
