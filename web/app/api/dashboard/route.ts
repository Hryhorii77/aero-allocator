import { NextResponse } from "next/server";
import { buildFullForecast } from "@/lib/snapshot";
import { withApiErrorHandling } from "@/lib/api-error";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { SETTINGS } from "aero-allocator/config";

// 60s is the ceiling on Vercel's Hobby plan; raise if on Pro/Enterprise and
// a cold build (up to ~1min with the default AERO_MAX_CANDIDATES) still hits it.
export const maxDuration = 60;

// Consolidates what the dashboard needs on load into one function
// invocation. Each app/api/*/route.ts file is its own separate serverless
// function on Vercel — hitting six of them in parallel (as the previous
// snapshot/allocation x3/lp-deposit/vote-swings split did) meant up to six
// independent cold snapshot builds (and six times the RPC load) per page
// view, since there's no shared memory between them. Building the snapshot
// once here and reusing it for every panel keeps that to one. Same
// computation as the paid api/v1/forecast — this route is free/unlimited,
// that one is x402-gated, for programmatic access without self-hosting.
//
// Rate limits: this is the free, unauthenticated route, and its heaviest
// lever is `?refresh=1`, which bypasses the engine's own snapshot cache
// (see lib/snapshot.ts) and forces a fresh RPC scan + DefiLlama price
// fetch. That's throttled to one per cache TTL per IP — asking for it more
// often than the cache would refresh anyway buys nothing but extra RPC
// load. Normal (cached) requests get a much looser budget purely to stop a
// runaway client loop, since they're already cheap.
export const GET = withApiErrorHandling("dashboard", async (req: Request) => {
  const params = new URL(req.url).searchParams;
  const refresh = params.get("refresh") === "1";
  const votingPower = Math.max(1, Number(params.get("votingPower") ?? 10000) || 10000);

  if (refresh) {
    const refreshLimit = checkRateLimit(req, { key: "dashboard-refresh", limit: 1, windowMs: SETTINGS.cacheTtlMs });
    if (!refreshLimit.allowed) return rateLimitResponse(refreshLimit.retryAfterSec);
  }
  const generalLimit = checkRateLimit(req, { key: "dashboard", limit: 30, windowMs: 60_000 });
  if (!generalLimit.allowed) return rateLimitResponse(generalLimit.retryAfterSec);

  return NextResponse.json(await buildFullForecast(votingPower, refresh));
});
