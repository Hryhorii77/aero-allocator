import { describe, expect, it, vi } from "vitest";

function makeForecast(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    pool: { lp: "0xpool1", symbol: "TEST/USDC", poolType: "v2-volatile", tvlUsd: 1234.6 },
    predictedFeesUsd: 100,
    lastEpochFeesUsd: 90,
    feeTrendUsdPerEpoch: 5,
    currentBribesUsd: 10,
    voteShare: 0.12345,
    predictedDemandShare: 0.2,
    predictiveEdge: 0.07655,
    rewardPer1kVotesUsd: 1.5,
    confidence: 0.8,
    ...overrides,
  };
}

const { calibratedSnapshot } = vi.hoisted(() => ({
  calibratedSnapshot: vi.fn(async (refresh: boolean) => ({
    generatedAt: 999,
    refresh,
    forecasts: [makeForecast()],
  })),
}));
vi.mock("@/lib/snapshot", () => ({ calibratedSnapshot }));

import { GET } from "./route";

function req(query: string): Request {
  return new Request(`http://localhost/api/snapshot${query}`);
}

describe("GET /api/snapshot", () => {
  it("shapes pool fields and rounds percentages to 2 decimal places", async () => {
    const res = await GET(req(""));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.generatedAt).toBe(999);
    expect(body.pools[0]).toMatchObject({
      lp: "0xpool1",
      symbol: "TEST/USDC",
      tvlUsd: 1235, // rounded
      voteSharePct: 12.35, // 0.12345 * 100, rounded to 2dp
      demandSharePct: 20,
      edgePct: 7.66, // 0.07655 * 100, rounded to 2dp
    });
  });

  it("passes refresh=1 through to calibratedSnapshot", async () => {
    await GET(req("?refresh=1"));
    expect(calibratedSnapshot).toHaveBeenLastCalledWith(true);
    await GET(req(""));
    expect(calibratedSnapshot).toHaveBeenLastCalledWith(false);
  });
});
