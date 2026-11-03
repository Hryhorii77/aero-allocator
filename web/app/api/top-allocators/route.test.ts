// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

const read = vi.hoisted(() => vi.fn());
vi.mock("@/lib/top-allocators-read", () => ({ readTopAllocators: read }));

import { GET } from "./route";

describe("GET /api/top-allocators", () => {
  it("returns the allocators with a 30-minute shared cache and no amount in the request", async () => {
    read.mockResolvedValue({ generatedAt: 1, totalPower: 10, allocators: [{ tokenId: "1", power: 5, onBase: 5, parts: [{ gauge: "0xa", pct: 100 }] }] });
    const res = await GET(new Request("http://x/api/top-allocators", { headers: { "x-forwarded-for": "9.9.9.1" } }));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("s-maxage=1800");
    expect((await res.json()).allocators[0].tokenId).toBe("1");
  });
});
