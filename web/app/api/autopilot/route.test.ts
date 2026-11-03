// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

const read = vi.hoisted(() => vi.fn());
vi.mock("@/lib/autopilot-read", () => ({ readAutopilot: read }));

import { GET } from "./route";

describe("GET /api/autopilot", () => {
  it("returns the pools with a 30-minute shared cache", async () => {
    read.mockResolvedValue({ generatedAt: 1, skipped: [], pools: [{ tokenId: "20366", power: 1, chains: [] }] });
    const res = await GET(new Request("http://x/api/autopilot", { headers: { "x-forwarded-for": "9.9.9.2" } }));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("s-maxage=1800");
    expect((await res.json()).pools[0].tokenId).toBe("20366");
  });
});
