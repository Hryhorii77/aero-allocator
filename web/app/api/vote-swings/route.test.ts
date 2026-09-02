import { describe, expect, it, vi, beforeEach } from "vitest";

const { getMarketSnapshot, detectVoteSwings } = vi.hoisted(() => ({
  getMarketSnapshot: vi.fn(async () => ({ generatedAt: 1, forecasts: [] })),
  detectVoteSwings: vi.fn((snap: unknown, opts: unknown) => ({ opts, risers: [], fallers: [] })),
}));

vi.mock("aero-allocator/scoring", () => ({ getMarketSnapshot, detectVoteSwings }));

import { GET } from "./route";

function req(query: string): Request {
  return new Request(`http://localhost/api/vote-swings${query}`);
}

beforeEach(() => {
  detectVoteSwings.mockClear();
});

describe("GET /api/vote-swings", () => {
  it("defaults maxPools to 8", async () => {
    const res = await GET(req(""));
    expect(res.status).toBe(200);
    expect(detectVoteSwings).toHaveBeenCalledWith(expect.anything(), { maxPools: 8 });
  });

  it("clamps maxPools into [1, 30]", async () => {
    // Not 0: `Number("0") || 8` hits the `|| default` fallback since 0 is
    // falsy — see the matching note in lp-deposit's route.test.ts.
    await GET(req("?maxPools=-5"));
    expect(detectVoteSwings).toHaveBeenLastCalledWith(expect.anything(), { maxPools: 1 });

    await GET(req("?maxPools=999"));
    expect(detectVoteSwings).toHaveBeenLastCalledWith(expect.anything(), { maxPools: 30 });
  });
});
