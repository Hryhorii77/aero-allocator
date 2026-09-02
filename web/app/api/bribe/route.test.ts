import { describe, expect, it, vi, beforeEach } from "vitest";

const { calibratedSnapshot, simulateBribeImpact } = vi.hoisted(() => ({
  calibratedSnapshot: vi.fn(async () => ({ generatedAt: 123, forecasts: [] })),
  simulateBribeImpact: vi.fn(),
}));

vi.mock("@/lib/snapshot", () => ({ calibratedSnapshot }));
vi.mock("aero-allocator/scoring", () => ({ simulateBribeImpact }));

import { GET } from "./route";

const VALID_POOL = "0x1234567890123456789012345678901234567890";

function req(query: string): Request {
  return new Request(`http://localhost/api/bribe${query}`);
}

beforeEach(() => {
  calibratedSnapshot.mockClear();
  simulateBribeImpact.mockReset();
});

describe("GET /api/bribe", () => {
  it("400s on a missing or malformed pool address, without touching the snapshot", async () => {
    let res = await GET(req(`?bribeBudgetUsd=100`));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/pool/i);

    res = await GET(req(`?pool=not-an-address&bribeBudgetUsd=100`));
    expect(res.status).toBe(400);
    expect(calibratedSnapshot).not.toHaveBeenCalled();
  });

  it("400s on a non-positive or missing bribeBudgetUsd", async () => {
    let res = await GET(req(`?pool=${VALID_POOL}`));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/bribeBudgetUsd/i);

    res = await GET(req(`?pool=${VALID_POOL}&bribeBudgetUsd=0`));
    expect(res.status).toBe(400);
  });

  it("200s with the simulation result for valid input", async () => {
    simulateBribeImpact.mockReturnValue({ pool: VALID_POOL, impact: 42 });
    const res = await GET(req(`?pool=${VALID_POOL}&bribeBudgetUsd=500`));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ pool: VALID_POOL, impact: 42 });
    expect(simulateBribeImpact).toHaveBeenCalledWith(expect.anything(), VALID_POOL, 500);
  });

  it("converts an application-level throw (e.g. pool not found) into a 400, not a 500", async () => {
    simulateBribeImpact.mockImplementation(() => {
      throw new Error("pool not found in current snapshot");
    });
    const res = await GET(req(`?pool=${VALID_POOL}&bribeBudgetUsd=500`));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("pool not found in current snapshot");
  });

  it("500s (via withApiErrorHandling) if the snapshot build itself throws", async () => {
    calibratedSnapshot.mockRejectedValue(new Error("RPC down"));
    const res = await GET(req(`?pool=${VALID_POOL}&bribeBudgetUsd=500`));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("RPC down");
  });
});
