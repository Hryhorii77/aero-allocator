import { NextResponse } from "next/server";
import { MAX_AMOUNT } from "@/lib/amount";
import { withApiErrorHandling } from "@/lib/api-error";
import { readAllChainsSplit } from "@/lib/all-chains-read";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";

export const maxDuration = 60;

/**
 * Read-only: the best split of an amount over every Aero chain, after the one-off ETH each extra chain costs to reach. Nothing here
 * sends or signs, and no address is involved. `days` is the horizon the fees are weighed against (default: the allocation wait).
 */
export const GET = withApiErrorHandling("all-chains-split", async (req: Request) => {
  const rl = checkRateLimit(req, { key: "all-chains-split", limit: 10, windowMs: 60_000 });
  if (!rl.allowed) return rateLimitResponse(rl.retryAfterSec);
  const q = new URL(req.url).searchParams;
  const amount = Number(q.get("amount"));
  if (!(amount > 0) || amount > MAX_AMOUNT) return NextResponse.json({ error: "amount must be above 0 and at most 1,000,000,000" }, { status: 400 });
  const rawDays = q.get("days");
  const days = rawDays === null ? undefined : Number(rawDays);
  if (days !== undefined && !(days >= 1 && days <= 90)) return NextResponse.json({ error: "days must be between 1 and 90" }, { status: 400 });
  const out = await readAllChainsSplit(amount, days);
  if (!out) return NextResponse.json({ error: "nothing to rank right now" }, { status: 503 });
  return NextResponse.json(out, { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" } });
});
