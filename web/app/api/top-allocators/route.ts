import { NextResponse } from "next/server";
import { withApiErrorHandling } from "@/lib/api-error";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { readTopAllocators } from "@/lib/top-allocators-read";

export const maxDuration = 60;

/**
 * Read-only: the largest sAERO positions by voting power and each one's split of its Base power, from public chain data. Position ids
 * only, never owners. No amount goes in: the page prices each split for the viewer's amount in the browser, so one cached answer serves all.
 */
export const GET = withApiErrorHandling("top-allocators", async (req: Request) => {
  const rl = checkRateLimit(req, { key: "top-allocators", limit: 10, windowMs: 60_000 });
  if (!rl.allowed) return rateLimitResponse(rl.retryAfterSec);
  return NextResponse.json(await readTopAllocators(), { headers: { "Cache-Control": "public, s-maxage=1800, stale-while-revalidate=3600" } });
});
