// @vitest-environment node
import { describe, expect, it, vi, beforeEach } from "vitest";

const gauges = vi.hoisted(() => ({
  getGauges: vi.fn(async () => ({ chainId: 8453, generatedAt: 0, totalWeight: 1, gauges: [{ gauge: "0x0000000000000000000000000000000000000001", pool: "0x0000000000000000000000000000000000000002", symbol: "A/B", weight: 200_000, sharePct: 1, capPerWeek: 1, activated: true, incentivesUsdPerWeek: 0, incentivesUsdPer1k: 0 }] })),
  getGaugeFees: vi.fn(async () => ({ chainId: 8453, generatedAt: 0, windowHours: 30, fees: [{ gauge: "0x0000000000000000000000000000000000000001", feesUsdPerDay: 1000, windowHours: 30 }] })),
}));
vi.mock("@/lib/gauges", () => ({ getGauges: gauges.getGauges }));
vi.mock("@/lib/gauge-fees-read", () => ({ getGaugeFees: gauges.getGaugeFees }));

import { GET } from "./route";

let ipCounter = 0;
// A distinct client per request keeps the route's per-IP rate limit out of the way.
function req(query = "") {
  ipCounter += 1;
  return new Request(`http://localhost/api/share${query}`, { headers: { "x-forwarded-for": `10.0.0.${ipCounter}` } });
}

const isPng = (png: Uint8Array) => [...png.slice(0, 4)].join() === [0x89, 0x50, 0x4e, 0x47].join();

beforeEach(() => {
  gauges.getGauges.mockClear();
  gauges.getGaugeFees.mockClear();
});

describe("GET /api/share", () => {
  it("returns a 1200×630 PNG, edge-cacheable, drawn from the Base gauges and fees", async () => {
    const res = await GET(req("?vp=25000"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("cache-control")).toMatch(/s-maxage=300/);
    const png = new Uint8Array(await res.arrayBuffer());
    expect(isPng(png)).toBe(true);
    const view = new DataView(png.buffer);
    expect([view.getUint32(16), view.getUint32(20)]).toEqual([1200, 630]);
    expect(gauges.getGauges).toHaveBeenCalledWith(8453);
    expect(gauges.getGaugeFees).toHaveBeenCalledWith(8453);
  });

  it("still renders a card, with a short cache and no leaked detail, when the gauges can't be read", async () => {
    gauges.getGauges.mockRejectedValueOnce(new Error("rpc exploded: secret-internal-detail"));
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("cache-control")).toMatch(/s-maxage=60/);
    expect(isPng(new Uint8Array(await res.arrayBuffer()))).toBe(true);
  });

  it("rate-limits one client hammering it", async () => {
    const hammer = () => new Request("http://localhost/api/share", { headers: { "x-forwarded-for": "203.0.113.9" } });
    const statuses: number[] = [];
    for (let i = 0; i < 25; i++) statuses.push((await GET(hammer())).status);
    expect(statuses).toContain(429);
  });
});
