import { NextResponse } from "next/server";
import { BASE_CHAIN } from "@/lib/aero-chains";
import { getGauges, SUPPORTED_CHAIN_IDS } from "@/lib/gauges";
import { withApiErrorHandling } from "@/lib/api-error";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";

export const maxDuration = 60;

export const GET = withApiErrorHandling("gauges", async (req: Request) => {
  const rl = checkRateLimit(req, { key: "gauges", limit: 30, windowMs: 60_000 });
  if (!rl.allowed) return rateLimitResponse(rl.retryAfterSec);
  const raw = new URL(req.url).searchParams.get("chain");
  const chainId = raw === null ? BASE_CHAIN.id : Number(raw);
  if (!SUPPORTED_CHAIN_IDS.includes(chainId)) return NextResponse.json({ error: "unsupported chain", supported: SUPPORTED_CHAIN_IDS }, { status: 400 });
  return NextResponse.json(await getGauges(chainId), { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" } });
});
