import { NextResponse } from "next/server";
import { withApiErrorHandling } from "@/lib/api-error";
import { readAutopilot } from "@/lib/autopilot-read";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";

export const maxDuration = 60;

/**
 * Read-only: Aero Autopilot's pooled positions (found by their owner's factory) and where each one's power sits on every chain, with each
 * gauge priced like the site's splits. No amount goes in; the page works out what a deposit would earn in the browser.
 */
export const GET = withApiErrorHandling("autopilot", async (req: Request) => {
  const rl = checkRateLimit(req, { key: "autopilot", limit: 10, windowMs: 60_000 });
  if (!rl.allowed) return rateLimitResponse(rl.retryAfterSec);
  return NextResponse.json(await readAutopilot(), { headers: { "Cache-Control": "public, s-maxage=1800, stale-while-revalidate=3600" } });
});
