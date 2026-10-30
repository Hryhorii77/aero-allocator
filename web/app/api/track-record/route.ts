import { NextResponse } from "next/server";
import { withApiErrorHandling } from "@/lib/api-error";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { getTrackRecord } from "@/lib/track-record-read";

/**
 * The site's own track record: each day's recommended split for 10,000 sAERO on Base, logged before the fact, against what those gauges
 * really paid over the following two days. Results appear only once 14 days are checked; before that the response says how many there are.
 */
export const GET = withApiErrorHandling("track-record", async (req: Request) => {
  const rl = checkRateLimit(req, { key: "track-record", limit: 30, windowMs: 60_000 });
  if (!rl.allowed) return rateLimitResponse(rl.retryAfterSec);
  return NextResponse.json(await getTrackRecord(), { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=900" } });
});
