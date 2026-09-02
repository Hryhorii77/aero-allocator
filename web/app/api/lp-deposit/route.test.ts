import { describe, expect, it, vi, beforeEach } from "vitest";

const { getMarketSnapshot, recommendLpDeposits, getRewardTokenPriceUsd } = vi.hoisted(() => ({
  getMarketSnapshot: vi.fn(async () => ({ generatedAt: 1, forecasts: [] })),
  recommendLpDeposits: vi.fn((snap: unknown, price: number, opts: unknown) => ({ price, opts, opportunities: [] })),
  getRewardTokenPriceUsd: vi.fn(async () => 1.23),
}));

vi.mock("aero-allocator/scoring", () => ({ getMarketSnapshot, recommendLpDeposits }));
vi.mock("aero-allocator/data", () => ({ getRewardTokenPriceUsd }));

import { GET } from "./route";

function req(query: string): Request {
  return new Request(`http://localhost/api/lp-deposit${query}`);
}

beforeEach(() => {
  recommendLpDeposits.mockClear();
});

describe("GET /api/lp-deposit", () => {
  it("defaults maxPools to 15 and passes the reward token price through", async () => {
    const res = await GET(req(""));
    expect(res.status).toBe(200);
    expect(recommendLpDeposits).toHaveBeenCalledWith(expect.anything(), 1.23, { maxPools: 15 });
  });

  it("clamps maxPools into [1, 60]", async () => {
    // Not 0: `Number("0") || 15` hits the `|| default` fallback since 0 is
    // falsy, so a literal 0 silently becomes the default rather than
    // clamping to 1 — a harmless quirk (0 pools isn't a meaningful request)
    // shared by every route using this parsing pattern, not something this
    // test is meant to lock in.
    await GET(req("?maxPools=-5"));
    expect(recommendLpDeposits).toHaveBeenLastCalledWith(expect.anything(), expect.anything(), { maxPools: 1 });

    await GET(req("?maxPools=1000"));
    expect(recommendLpDeposits).toHaveBeenLastCalledWith(expect.anything(), expect.anything(), { maxPools: 60 });
  });
});
