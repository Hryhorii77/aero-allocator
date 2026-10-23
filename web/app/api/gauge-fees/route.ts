import { NextResponse } from "next/server";
import { AERO_CHAINS, BASE_CHAIN } from "@/lib/aero-chains";
import { getGaugeFees } from "@/lib/gauge-fees-read";
import { withApiErrorHandling } from "@/lib/api-error";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";

export const maxDuration = 60;

const FEE_CHAIN_IDS = AERO_CHAINS.filter((c) => c.feeLogs).map((c) => c.id);

export const GET = withApiErrorHandling("gauge-fees", async (req: Request) => {
  const rl = checkRateLimit(req, { key: "gauge-fees", limit: 20, windowMs: 60_000 });
  if (!rl.allowed) return rateLimitResponse(rl.retryAfterSec);
  const raw = new URL(req.url).searchParams.get("chain");
  const chainId = raw === null ? BASE_CHAIN.id : Number(raw);
  if (!FEE_CHAIN_IDS.includes(chainId)) return NextResponse.json({ error: "fee pace is not measured on this chain", supported: FEE_CHAIN_IDS }, { status: 400 });
  return NextResponse.json(await getGaugeFees(chainId));
});
