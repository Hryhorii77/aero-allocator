// @vitest-environment node
import { describe, expect, it, vi, beforeEach } from "vitest";

const { calibratedSnapshot, recommendAllocation } = vi.hoisted(() => ({
  calibratedSnapshot: vi.fn(async () => ({ generatedAt: 123, forecasts: [] })),
  recommendAllocation: vi.fn((_snap: unknown, _objective: string, _maxPools: number, _vp: number) => ({
    allocations: [{ expectedRewardUsd: 40 }, { expectedRewardUsd: 2.5 }],
  })),
}));

vi.mock("@/lib/snapshot", () => ({ calibratedSnapshot }));
vi.mock("aero-allocator/scoring", () => ({ recommendAllocation }));

import { GET } from "./route";

let ipCounter = 0;
// A distinct client per request keeps the route's per-IP rate limit out of the way.
function req(query = "") {
  ipCounter += 1;
  return new Request(`http://localhost/api/share${query}`, { headers: { "x-forwarded-for": `10.0.0.${ipCounter}` } });
}

beforeEach(() => {
  calibratedSnapshot.mockClear();
  recommendAllocation.mockClear();
});

describe("GET /api/share", () => {
  it("returns a 1200×630 PNG, edge-cacheable", async () => {
    const res = await GET(req("?vp=25000"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("cache-control")).toMatch(/s-maxage=\d+/);
    const png = new Uint8Array(await res.arrayBuffer());
    expect([...png.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    const view = new DataView(png.buffer);
    expect([view.getUint32(16), view.getUint32(20)]).toEqual([1200, 630]);
    // Sized for the requested amount, using the same 8-pool voter_roi call as the page.
    expect(recommendAllocation).toHaveBeenCalledWith(expect.anything(), "voter_roi", 8, 25000);
  });

  it("falls back to the 10,000 default for a missing, junk, negative or absurd amount", async () => {
    for (const q of ["", "?vp=abc", "?vp=-5", "?vp=0", "?vp=99999999999999"]) {
      recommendAllocation.mockClear();
      const res = await GET(req(q));
      expect(res.status).toBe(200);
      expect(recommendAllocation).toHaveBeenCalledWith(expect.anything(), "voter_roi", 8, 10000);
    }
  });

  it("answers 500 with a plain message, not a stack trace, when the snapshot fails", async () => {
    calibratedSnapshot.mockRejectedValueOnce(new Error("rpc exploded: secret-internal-detail"));
    const res = await GET(req());
    expect(res.status).toBe(500);
    expect(await res.text()).toBe("Failed to generate the card");
  });

  it("rate-limits one client hammering it", async () => {
    const hammer = () =>
      new Request("http://localhost/api/share", { headers: { "x-forwarded-for": "203.0.113.9" } });
    const statuses: number[] = [];
    for (let i = 0; i < 25; i++) statuses.push((await GET(hammer())).status);
    expect(statuses).toContain(429);
  });
});
