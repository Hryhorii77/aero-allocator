import { NextResponse } from "next/server";
import { BASE_CHAIN } from "@/lib/aero-chains";
import { SUPPORTED_CHAIN_IDS } from "@/lib/gauges";
import { getGaugeFlows } from "@/lib/weight-history-read";
import { withApiErrorHandling } from "@/lib/api-error";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";

export const maxDuration = 30;

// Which gauges are gaining or losing share of the allocation weight, from the snapshots the ingest cron stores every 30 minutes.
export const GET = withApiErrorHandling("gauge-flows", async (req: Request) => {
  const rl = checkRateLimit(req, { key: "gauge-flows", limit: 30, windowMs: 60_000 });
  if (!rl.allowed) return rateLimitResponse(rl.retryAfterSec);
  const raw = new URL(req.url).searchParams.get("chain");
  const chainId = raw === null ? BASE_CHAIN.id : Number(raw);
  if (!SUPPORTED_CHAIN_IDS.includes(chainId)) return NextResponse.json({ error: "unsupported chain", supported: SUPPORTED_CHAIN_IDS }, { status: 400 });
  return NextResponse.json(await getGaugeFlows(chainId), { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" } });
});
