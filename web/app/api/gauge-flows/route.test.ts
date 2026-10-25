// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

const read = vi.hoisted(() => ({ getGaugeFlows: vi.fn(async (chainId: number) => ({ chainId, spanHours: 0, flows: [] })) }));
vi.mock("@/lib/weight-history-read", () => ({ getGaugeFlows: read.getGaugeFlows }));

import { GET } from "./route";

let n = 0;
const req = (q = "") => new Request(`http://localhost/api/gauge-flows${q}`, { headers: { "x-forwarded-for": `10.1.0.${++n}` } });

describe("GET /api/gauge-flows", () => {
  it("defaults to Base and is edge-cacheable", async () => {
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(read.getGaugeFlows).toHaveBeenCalledWith(8453);
    expect(res.headers.get("cache-control")).toMatch(/s-maxage=300/);
  });
  it("rejects a chain it doesn't read", async () => {
    const res = await GET(req("?chain=999"));
    expect(res.status).toBe(400);
  });
});
