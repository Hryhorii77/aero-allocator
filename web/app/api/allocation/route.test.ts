import { describe, expect, it, vi, beforeEach } from "vitest";

const { calibratedSnapshot, recommendAllocation } = vi.hoisted(() => ({
  calibratedSnapshot: vi.fn(async () => ({ generatedAt: 123, forecasts: [] })),
  recommendAllocation: vi.fn((snap: unknown, objective: string, maxPools: number, votingPower: number) => ({
    objective,
    maxPools,
    votingPower,
    allocations: [],
  })),
}));

vi.mock("@/lib/snapshot", () => ({ calibratedSnapshot }));
vi.mock("aero-allocator/scoring", () => ({ recommendAllocation }));

import { GET } from "./route";

function req(query: string): Request {
  return new Request(`http://localhost/api/allocation${query}`);
}

beforeEach(() => {
  calibratedSnapshot.mockClear();
  recommendAllocation.mockClear();
});

describe("GET /api/allocation", () => {
  it("defaults to voter_roi, 8 pools, 10000 voting power", async () => {
    const res = await GET(req(""));
    expect(res.status).toBe(200);
    expect(recommendAllocation).toHaveBeenCalledWith(expect.anything(), "voter_roi", 8, 10000);
  });

  it("passes through a valid requested objective", async () => {
    await GET(req("?objective=edge_hunter"));
    expect(recommendAllocation).toHaveBeenCalledWith(expect.anything(), "edge_hunter", 8, 10000);
  });

  it("falls back to voter_roi for an invalid objective", async () => {
    await GET(req("?objective=not_a_real_objective"));
    expect(recommendAllocation).toHaveBeenCalledWith(expect.anything(), "voter_roi", 8, 10000);
  });

  it("clamps maxPools into [2, 20]", async () => {
    await GET(req("?maxPools=1"));
    expect(recommendAllocation).toHaveBeenCalledWith(expect.anything(), expect.anything(), 2, expect.anything());

    await GET(req("?maxPools=999"));
    expect(recommendAllocation).toHaveBeenCalledWith(expect.anything(), expect.anything(), 20, expect.anything());
  });

  it("floors votingPower at 1 and ignores non-numeric input", async () => {
    await GET(req("?votingPower=-50"));
    expect(recommendAllocation).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.anything(), 1);

    recommendAllocation.mockClear();
    await GET(req("?votingPower=notanumber"));
    expect(recommendAllocation).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.anything(), 10000);
  });
});
