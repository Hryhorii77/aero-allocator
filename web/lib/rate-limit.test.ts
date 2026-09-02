import { describe, expect, it } from "vitest";
import { checkRateLimit, rateLimitResponse } from "./rate-limit";

function req(ip: string): Request {
  return new Request("http://localhost/api/test", { headers: { "x-forwarded-for": ip } });
}

describe("checkRateLimit", () => {
  it("allows requests under the limit", () => {
    const ip = "1.1.1.1";
    for (let i = 0; i < 3; i++) {
      expect(checkRateLimit(req(ip), { key: "k1", limit: 3, windowMs: 60_000 }).allowed).toBe(true);
    }
  });

  it("blocks once the limit is exceeded within the window", () => {
    const ip = "1.1.1.2";
    for (let i = 0; i < 3; i++) checkRateLimit(req(ip), { key: "k2", limit: 3, windowMs: 60_000 });
    const result = checkRateLimit(req(ip), { key: "k2", limit: 3, windowMs: 60_000 });
    expect(result.allowed).toBe(false);
    expect(result.retryAfterSec).toBeGreaterThan(0);
  });

  it("tracks separate IPs independently", () => {
    const key = "k3";
    for (let i = 0; i < 2; i++) checkRateLimit(req("2.2.2.1"), { key, limit: 2, windowMs: 60_000 });
    expect(checkRateLimit(req("2.2.2.1"), { key, limit: 2, windowMs: 60_000 }).allowed).toBe(false);
    // A different IP has its own budget, untouched by 2.2.2.1's usage.
    expect(checkRateLimit(req("2.2.2.2"), { key, limit: 2, windowMs: 60_000 }).allowed).toBe(true);
  });

  it("tracks separate keys independently for the same IP", () => {
    const ip = "3.3.3.3";
    checkRateLimit(req(ip), { key: "general", limit: 1, windowMs: 60_000 });
    expect(checkRateLimit(req(ip), { key: "general", limit: 1, windowMs: 60_000 }).allowed).toBe(false);
    // "refresh" is a different bucket for the same IP — unaffected by "general" being exhausted.
    expect(checkRateLimit(req(ip), { key: "refresh", limit: 1, windowMs: 60_000 }).allowed).toBe(true);
  });

  it("extracts the first IP from a multi-hop x-forwarded-for header", () => {
    const key = "k4";
    const multiHop = new Request("http://localhost/api/test", {
      headers: { "x-forwarded-for": "4.4.4.4, 5.5.5.5, 6.6.6.6" },
    });
    checkRateLimit(multiHop, { key, limit: 1, windowMs: 60_000 });
    // Same first-hop IP, differently formatted header — should hit the same bucket.
    expect(checkRateLimit(req("4.4.4.4"), { key, limit: 1, windowMs: 60_000 }).allowed).toBe(false);
  });

  it("falls back to x-real-ip, then a shared unknown bucket", () => {
    const realIp = new Request("http://localhost/api/test", { headers: { "x-real-ip": "7.7.7.7" } });
    expect(checkRateLimit(realIp, { key: "k5", limit: 1, windowMs: 60_000 }).allowed).toBe(true);

    const noHeaders = new Request("http://localhost/api/test");
    expect(checkRateLimit(noHeaders, { key: "k6", limit: 1, windowMs: 60_000 }).allowed).toBe(true);
  });
});

describe("rateLimitResponse", () => {
  it("returns 429 with a Retry-After header and JSON error body", async () => {
    const res = rateLimitResponse(42);
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("42");
    const body = await res.json();
    expect(body.error).toContain("42s");
  });
});
