import { NextResponse } from "next/server";
import { BASE_CHAIN } from "@/lib/aero-chains";
import { quoteCrossChain } from "@/lib/allocate-fee";
import { SUPPORTED_CHAIN_IDS } from "@/lib/gauges";
import { withApiErrorHandling } from "@/lib/api-error";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";

export const maxDuration = 30;

/** Read-only quote of the ETH an allocation to another chain needs (paid on Base). Never sends anything. */
export const GET = withApiErrorHandling("allocation-fee", async (req: Request) => {
  const rl = checkRateLimit(req, { key: "allocation-fee", limit: 30, windowMs: 60_000 });
  if (!rl.allowed) return rateLimitResponse(rl.retryAfterSec);
  const q = new URL(req.url).searchParams;
  const chainId = Number(q.get("chain"));
  const gauges = Number(q.get("gauges") ?? 1);
  if (!SUPPORTED_CHAIN_IDS.includes(chainId) || chainId === BASE_CHAIN.id) return NextResponse.json({ error: "pick a chain other than Base" }, { status: 400 });
  if (!Number.isInteger(gauges) || gauges < 1 || gauges > 20) return NextResponse.json({ error: "gauges must be 1-20" }, { status: 400 });
  return NextResponse.json(await quoteCrossChain(chainId, gauges), { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" } });
});
