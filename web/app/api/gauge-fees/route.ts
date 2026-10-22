import { NextResponse } from "next/server";
import { getGaugeFees } from "@/lib/gauge-fees-read";
import { withApiErrorHandling } from "@/lib/api-error";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";

export const maxDuration = 60;

export const GET = withApiErrorHandling("gauge-fees", async (req: Request) => {
  const rl = checkRateLimit(req, { key: "gauge-fees", limit: 20, windowMs: 60_000 });
  if (!rl.allowed) return rateLimitResponse(rl.retryAfterSec);
  return NextResponse.json(await getGaugeFees());
});
