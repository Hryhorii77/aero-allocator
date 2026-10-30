// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

const gauges = vi.hoisted(() => vi.fn());
const fees = vi.hoisted(() => vi.fn());
vi.mock("@/lib/gauges", async (orig) => ({ ...(await orig<typeof import("@/lib/gauges")>()), getGauges: gauges }));
vi.mock("@/lib/gauge-fees-read", () => ({ getGaugeFees: fees }));

import { GET } from "./route";

let n = 0;
const call = (qs: string) => {
  n += 1;
  return GET(new Request(`http://x/api/top-gauges?${qs}`, { headers: { "x-forwarded-for": `9.8.7.${n}` } }));
};
const G1 = "0x0000000000000000000000000000000000000001";

describe("GET /api/top-gauges", () => {
  it("rejects a bad amount, chain or limit before reading anything", async () => {
    for (const qs of ["", "amount=0", "amount=abc", "amount=2000000000", "amount=100&chain=999", "amount=100&limit=0", "amount=100&limit=26", "amount=100&limit=2.5"]) {
      expect((await call(qs)).status, qs).toBe(400);
    }
    expect(gauges).not.toHaveBeenCalled();
  });

  it("ranks the chain's gauges for the amount rounded to three figures and caches the answer", async () => {
    gauges.mockResolvedValue({ chainId: 8453, generatedAt: 0, totalWeight: 1, cooldownSec: 169_200, gauges: [{ gauge: G1, pool: G1, symbol: "A/B", weight: 200_000, sharePct: 1, capPerWeek: 1, activated: true, incentivesUsdPerWeek: 0, incentivesUsdPer1k: 0, poolType: "CL100" }] });
    fees.mockResolvedValue({ chainId: 8453, generatedAt: 1, windowHours: 40, fees: [{ gauge: G1, feesUsdPerDay: 100, windowHours: 40 }] });
    const res = await call("amount=12345&limit=3");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("s-maxage=60");
    const body = await res.json();
    expect(body.amount).toBe(12300);
    expect(body.chainId).toBe(8453);
    expect(body.gauges[0].label).toBe("A/B · CL100");
  });
});
