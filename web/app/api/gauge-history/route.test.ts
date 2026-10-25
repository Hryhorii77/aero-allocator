// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

const read = vi.hoisted(() => ({ getGaugeHistory: vi.fn() }));
vi.mock("@/lib/gauge-fees-read", () => ({ getGaugeHistory: read.getGaugeHistory }));

import { GET } from "./route";

const GAUGE = "0x0000000000000000000000000000000000000abc";
let n = 0;
const req = (q: string) => new Request(`http://localhost/api/gauge-history${q}`, { headers: { "x-forwarded-for": `10.2.0.${++n}` } });

describe("GET /api/gauge-history", () => {
  it("returns a gauge's history, edge-cacheable", async () => {
    read.getGaugeHistory.mockResolvedValueOnce({ chainId: 8453, gauge: GAUGE, fees: [], weights: [], flow: null, steady: null });
    const res = await GET(req(`?gauge=${GAUGE}`));
    expect(res.status).toBe(200);
    expect(read.getGaugeHistory).toHaveBeenCalledWith(8453, GAUGE);
    expect(res.headers.get("cache-control")).toMatch(/s-maxage=300/);
  });
  it("rejects a bad gauge address or an unmeasured chain before reading anything", async () => {
    read.getGaugeHistory.mockClear();
    expect((await GET(req("?gauge=nope"))).status).toBe(400);
    expect((await GET(req(`?chain=999&gauge=${GAUGE}`))).status).toBe(400);
    expect(read.getGaugeHistory).not.toHaveBeenCalled();
  });
  it("is a 404 for a gauge the chain doesn't have", async () => {
    read.getGaugeHistory.mockResolvedValueOnce(null);
    expect((await GET(req(`?gauge=${GAUGE}`))).status).toBe(404);
  });
});
