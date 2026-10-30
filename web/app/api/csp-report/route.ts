import { NextResponse } from "next/server";
import { withApiErrorHandling } from "@/lib/api-error";
import { readViolation } from "@/lib/csp-report";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";

const MAX_BODY = 8 * 1024;
/**
 * Where browsers send what the report-only Content Security Policy would have blocked (see lib/csp.ts). It stores nothing: each report
 * becomes one log line with a few clipped fields (no query strings, no headers, no addresses) so the policy can be tuned from Vercel's logs.
 */
export const POST = withApiErrorHandling("csp-report", async (req: Request) => {
  const rl = checkRateLimit(req, { key: "csp-report", limit: 20, windowMs: 60_000 });
  if (!rl.allowed) return rateLimitResponse(rl.retryAfterSec);
  const text = await req.text();
  if (text.length > MAX_BODY) return NextResponse.json({ error: "too large" }, { status: 413 });
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "not json" }, { status: 400 });
  }
  const items = (Array.isArray(json) ? json : [json]).slice(0, 5);
  for (const item of items) {
    const v = readViolation(item);
    if (v) console.warn("csp report", JSON.stringify(v));
  }
  return new NextResponse(null, { status: 204 });
});
