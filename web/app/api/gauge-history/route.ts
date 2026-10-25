import { NextResponse } from "next/server";
import { isAddress } from "viem";
import { AERO_CHAINS, BASE_CHAIN } from "@/lib/aero-chains";
import { getGaugeHistory } from "@/lib/gauge-fees-read";
import { withApiErrorHandling } from "@/lib/api-error";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";

export const maxDuration = 30;

const FEE_CHAIN_IDS = AERO_CHAINS.filter((c) => c.feeLogs).map((c) => c.id);

// One gauge's recent history for the chart under its table row: fees released per 6 hours (from the stored fee record), its weight
// at each stored snapshot, and its steadiness. Read-only.
export const GET = withApiErrorHandling("gauge-history", async (req: Request) => {
  const rl = checkRateLimit(req, { key: "gauge-history", limit: 30, windowMs: 60_000 });
  if (!rl.allowed) return rateLimitResponse(rl.retryAfterSec);
  const params = new URL(req.url).searchParams;
  const raw = params.get("chain");
  const chainId = raw === null ? BASE_CHAIN.id : Number(raw);
  if (!FEE_CHAIN_IDS.includes(chainId)) return NextResponse.json({ error: "history is not measured on this chain", supported: FEE_CHAIN_IDS }, { status: 400 });
  const gauge = params.get("gauge") ?? "";
  if (!isAddress(gauge)) return NextResponse.json({ error: "gauge must be an address" }, { status: 400 });
  const history = await getGaugeHistory(chainId, gauge);
  if (!history) return NextResponse.json({ error: "no such gauge on this chain" }, { status: 404 });
  return NextResponse.json(history, { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" } });
});
