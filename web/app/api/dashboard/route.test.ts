import { describe, expect, it, vi, beforeEach } from "vitest";

const { buildFullForecast } = vi.hoisted(() => ({
  buildFullForecast: vi.fn(async (votingPower: number, refresh: boolean) => ({ votingPower, refresh })),
}));
vi.mock("@/lib/snapshot", () => ({ buildFullForecast }));

import { GET } from "./route";

// Rate-limit buckets are keyed by IP (see lib/rate-limit.ts) and persist at
// module scope for the process lifetime — give each test its own IP so
// they can't see each other's request counts.
let ipCounter = 0;
function req(query: string): Request {
  ipCounter++;
  return new Request(`http://localhost/api/dashboard${query}`, {
    headers: { "x-forwarded-for": `10.0.0.${ipCounter}` },
  });
}

beforeEach(() => {
  buildFullForecast.mockClear();
});

describe("GET /api/dashboard", () => {
  it("defaults votingPower to 10000 and refresh to false", async () => {
    const res = await GET(req(""));
    expect(res.status).toBe(200);
    expect(buildFullForecast).toHaveBeenCalledWith(10000, false);
  });

  it("parses votingPower and refresh=1 from query params", async () => {
    await GET(req("?votingPower=25000&refresh=1"));
    expect(buildFullForecast).toHaveBeenCalledWith(25000, true);
  });

  it("floors votingPower at 1 and ignores non-numeric input", async () => {
    await GET(req("?votingPower=-5"));
    expect(buildFullForecast).toHaveBeenLastCalledWith(1, false);

    await GET(req("?votingPower=garbage"));
    expect(buildFullForecast).toHaveBeenLastCalledWith(10000, false);
  });

  it("rate-limits repeated non-refresh requests from the same IP past 30/min", async () => {
    const ip = "20.0.0.1";
    const sameIpReq = () => new Request("http://localhost/api/dashboard", { headers: { "x-forwarded-for": ip } });
    let lastRes;
    for (let i = 0; i < 31; i++) lastRes = await GET(sameIpReq());
    expect(lastRes!.status).toBe(429);
    expect(lastRes!.headers.get("Retry-After")).toBeTruthy();
  });

  it("rate-limits a second refresh=1 request from the same IP within the cache TTL window", async () => {
    const ip = "20.0.0.2";
    const refreshReq = () =>
      new Request("http://localhost/api/dashboard?refresh=1", { headers: { "x-forwarded-for": ip } });
    const first = await GET(refreshReq());
    expect(first.status).toBe(200);
    const second = await GET(refreshReq());
    expect(second.status).toBe(429);
  });

  it("a blocked refresh=1 request does not consume the general budget", async () => {
    const ip = "20.0.0.3";
    await GET(new Request("http://localhost/api/dashboard?refresh=1", { headers: { "x-forwarded-for": ip } }));
    const blockedRefresh = await GET(
      new Request("http://localhost/api/dashboard?refresh=1", { headers: { "x-forwarded-for": ip } }),
    );
    expect(blockedRefresh.status).toBe(429);
    // The general (non-refresh) budget should be untouched by the blocked refresh attempt.
    const normal = await GET(new Request("http://localhost/api/dashboard", { headers: { "x-forwarded-for": ip } }));
    expect(normal.status).toBe(200);
  });
});
