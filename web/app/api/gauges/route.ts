import { NextResponse } from "next/server";
import { getBaseGauges } from "@/lib/gauges";
import { withApiErrorHandling } from "@/lib/api-error";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";

export const GET = withApiErrorHandling("gauges", async (req: Request) => {
  const rl = checkRateLimit(req, { key: "gauges", limit: 30, windowMs: 60_000 });
  if (!rl.allowed) return rateLimitResponse(rl.retryAfterSec);
  return NextResponse.json(await getBaseGauges());
});
