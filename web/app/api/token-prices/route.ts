import { NextResponse } from "next/server";
import { isAddress } from "viem";
import { getPrices } from "@/lib/prices";
import { withApiErrorHandling } from "@/lib/api-error";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";

export const maxDuration = 30;

const MAX_TOKENS = 12;

// USD prices for a few Base token addresses (the fee tokens of gauges), so the page can value a position's earned fees in the browser
// without sending the position or the wallet anywhere: only public token addresses go in. Unpriced tokens are simply left out.
export const GET = withApiErrorHandling("token-prices", async (req: Request) => {
  const rl = checkRateLimit(req, { key: "token-prices", limit: 30, windowMs: 60_000 });
  if (!rl.allowed) return rateLimitResponse(rl.retryAfterSec);
  const raw = new URL(req.url).searchParams.get("tokens") ?? "";
  const tokens = [...new Set(raw.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean))];
  if (tokens.length === 0 || tokens.length > MAX_TOKENS || tokens.some((t) => !isAddress(t))) {
    return NextResponse.json({ error: `tokens must be 1-${MAX_TOKENS} comma-separated addresses` }, { status: 400 });
  }
  const found = await getPrices(tokens).catch(() => new Map());
  const prices: Record<string, number> = {};
  for (const t of tokens) {
    const p = found.get(t);
    if (p && p.priceUsd > 0) prices[t] = p.priceUsd;
  }
  return NextResponse.json({ prices }, { headers: { "Cache-Control": "public, s-maxage=120, stale-while-revalidate=600" } });
});
