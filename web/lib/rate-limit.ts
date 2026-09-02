import { NextResponse } from "next/server";

// In-memory, per-serverless-instance rate limiting — no external store, so
// no new account/service to wire up. This is a best-effort guard against a
// runaway client loop or basic scripted abuse, not a hard distributed
// limit: Vercel can route a determined attacker's requests across many
// concurrent instances, each with its own independent bucket. It's enough
// to bound the common case (one client hammering the endpoint) without
// adding infrastructure.
const buckets = new Map<string, { count: number; resetAt: number }>();

// Crude safeguard against unbounded growth on a very long-lived warm
// instance — an attacker with enough unique IPs to hit this is already
// beyond what an in-memory limiter can meaningfully stop.
const MAX_TRACKED_KEYS = 10_000;

// Trusting the first x-forwarded-for entry is only safe because Vercel
// itself overwrites this header and never forwards a client-supplied value
// (https://vercel.com/docs/headers/request-headers#x-forwarded-for) — on
// any other host (self-hosted per this repo's README, or behind a
// different reverse proxy) a client can set this header to anything,
// making it trivial to get a fresh "IP" — and fresh rate-limit budget —
// on every request.
function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSec: number;
}

/**
 * Fixed-window per-IP rate limit, scoped by `key` (so e.g. a route's normal
 * traffic and its expensive `?refresh=1` path can have separate budgets).
 */
export function checkRateLimit(req: Request, opts: { key: string; limit: number; windowMs: number }): RateLimitResult {
  const now = Date.now();
  const bucketKey = `${opts.key}:${clientIp(req)}`;
  const existing = buckets.get(bucketKey);

  if (!existing || now >= existing.resetAt) {
    if (buckets.size >= MAX_TRACKED_KEYS) buckets.clear();
    buckets.set(bucketKey, { count: 1, resetAt: now + opts.windowMs });
    return { allowed: true, retryAfterSec: 0 };
  }

  if (existing.count >= opts.limit) {
    return { allowed: false, retryAfterSec: Math.ceil((existing.resetAt - now) / 1000) };
  }

  existing.count++;
  return { allowed: true, retryAfterSec: 0 };
}

export function rateLimitResponse(retryAfterSec: number): NextResponse {
  return NextResponse.json(
    { error: `Rate limit exceeded. Try again in ${retryAfterSec}s.` },
    { status: 429, headers: { "Retry-After": String(retryAfterSec) } },
  );
}
