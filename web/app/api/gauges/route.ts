import { NextResponse } from "next/server";
import { readBaseGauges, type GaugeList } from "@/lib/gauges";
import { withApiErrorHandling } from "@/lib/api-error";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";

// One read of ~270 gauges costs a few dozen RPC multicalls, so share it across requests for a minute.
const TTL_MS = 60_000;
let cache: { at: number; value: GaugeList } | null = null;
let inflight: Promise<GaugeList> | null = null;

export const GET = withApiErrorHandling("gauges", async (req: Request) => {
  const rl = checkRateLimit(req, { key: "gauges", limit: 30, windowMs: 60_000 });
  if (!rl.allowed) return rateLimitResponse(rl.retryAfterSec);
  if (!cache || Date.now() - cache.at > TTL_MS) {
    inflight ??= readBaseGauges().finally(() => {
      inflight = null;
    });
    cache = { at: Date.now(), value: await inflight };
  }
  return NextResponse.json(cache.value);
});
