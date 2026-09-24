import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

// Same module-boundary mock and reasoning as the sibling forecast route test:
// @x402/next's dist build does an extensionless `import ... from
// "next/server"` that Vitest's ESM resolver can't follow, and we're testing
// our own route logic (validation, blending, usage logging) rather than the
// payment library's verification internals. Identity-wrapping withX402 lets
// the "configured" cases actually invoke the wrapped handler.
vi.mock("@x402/next", () => ({
  withX402: vi.fn((handler: unknown) => handler),
  x402ResourceServer: class {
    register() {
      return this;
    }
  },
}));

const { calibratedSnapshot, fetchAccountLocks, recommendAllocation } = vi.hoisted(() => ({
  calibratedSnapshot: vi.fn(),
  fetchAccountLocks: vi.fn(),
  recommendAllocation: vi.fn(),
}));
vi.mock("@/lib/snapshot", () => ({ calibratedSnapshot }));
vi.mock("aero-allocator/lockers", () => ({ fetchAccountLocks }));
vi.mock("aero-allocator/scoring", () => ({ recommendAllocation }));

const ADDRESS = "0x1234567890123456789012345678901234567890";

// Two pools: one the wallet holds, one the recommendation wants.
const snapshot = {
  forecasts: [
    { pool: { lp: "0xaaa", symbol: "A/USDC" }, rewardPer1kVotesUsd: 2 },
    { pool: { lp: "0xbbb", symbol: "B/USDC" }, rewardPer1kVotesUsd: 9 },
  ],
};

beforeEach(() => {
  vi.resetModules();
  vi.unstubAllEnvs();
  calibratedSnapshot.mockReset().mockResolvedValue(snapshot);
  recommendAllocation.mockReset().mockReturnValue({
    summary: "test summary",
    allocations: [{ pool: "0xbbb", symbol: "B/USDC", weightPct: 100, expectedRewardUsd: 90 }],
  });
  fetchAccountLocks.mockReset().mockResolvedValue([
    { tokenId: "1", votingPower: 10_000, votes: [{ pool: "0xaaa", weightPct: 100 }], permanent: true, expiresAt: 0 },
  ]);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function stubConfigured() {
  vi.stubEnv("X402_PAYTO_ADDRESS", ADDRESS);
  vi.stubEnv("CDP_API_KEY_ID", "some-id");
  vi.stubEnv("CDP_API_KEY_SECRET", "some-secret");
}

const call = async (query: string) => {
  const { GET } = await import("./route");
  return GET(new NextRequest(`http://localhost/api/v1/position${query}`));
};

describe("GET /api/v1/position", () => {
  it("serves a clear 501 (not a crash) when x402 env is unconfigured", async () => {
    vi.stubEnv("X402_PAYTO_ADDRESS", "");
    vi.stubEnv("CDP_API_KEY_ID", "");
    vi.stubEnv("CDP_API_KEY_SECRET", "");

    const res = await call(`?address=${ADDRESS}`);

    expect(res.status).toBe(501);
    expect((await res.json()).error).toMatch(/X402_PAYTO_ADDRESS/);
  });

  it("rejects a missing or malformed address with 400, before doing any chain work", async () => {
    stubConfigured();

    for (const q of ["", "?address=", "?address=nonsense", "?address=0x1234"]) {
      const res = await call(q);
      expect(res.status).toBe(400);
    }
    // 400 short-circuits settlement in withX402, so a typo must never reach
    // the (billable, slow) chain read.
    expect(fetchAccountLocks).not.toHaveBeenCalled();
    expect(calibratedSnapshot).not.toHaveBeenCalled();
  });

  it("returns 404 rather than a zeroed position when the wallet holds no locks", async () => {
    stubConfigured();
    fetchAccountLocks.mockResolvedValue([]);

    const res = await call(`?address=${ADDRESS}`);

    // A confident "$0.00 delta" for a wallet with nothing at stake would read
    // as a real answer. >= 400 also means the caller isn't charged.
    expect(res.status).toBe(404);
  });

  it("prices the wallet's actual split against a recommendation sized for its own voting power", async () => {
    stubConfigured();

    const res = await call(`?address=${ADDRESS}`);
    const body = await res.json();

    expect(res.status).toBe(200);
    // 10,000 ve entirely in 0xaaa at $2/1k = $20 to stay; the recommendation
    // expects $90 to switch.
    expect(body.estimateIfStayUsd).toBeCloseTo(20, 6);
    expect(body.estimateIfSwitchUsd).toBeCloseTo(90, 6);
    expect(body.deltaUsd).toBeCloseTo(70, 6);
    expect(body.comparable).toBe(true);
    // Sized for this wallet, not the 10,000 default by coincidence.
    expect(recommendAllocation).toHaveBeenCalledWith(snapshot, "voter_roi", 8, 10_000);
  });

  it("blends several locks into one position and sizes the recommendation for the total", async () => {
    stubConfigured();
    fetchAccountLocks.mockResolvedValue([
      { tokenId: "1", votingPower: 300_000, votes: [{ pool: "0xaaa", weightPct: 100 }], permanent: true, expiresAt: 0 },
      { tokenId: "2", votingPower: 100_000, votes: [{ pool: "0xbbb", weightPct: 100 }], permanent: true, expiresAt: 0 },
    ]);

    const body = await (await call(`?address=${ADDRESS}`)).json();

    expect(body.votingPower).toBe(400_000);
    expect(body.locks).toHaveLength(2);
    // 75% of 400k in 0xaaa @ $2/1k = $600; 25% in 0xbbb @ $9/1k = $900.
    expect(body.estimateIfStayUsd).toBeCloseTo(1_500, 6);
    expect(recommendAllocation).toHaveBeenCalledWith(snapshot, "voter_roi", 8, 400_000);
  });

  it("flags an unpriced held pool instead of quietly overstating the gain from switching", async () => {
    stubConfigured();
    fetchAccountLocks.mockResolvedValue([
      {
        tokenId: "1",
        votingPower: 10_000,
        votes: [
          { pool: "0xaaa", weightPct: 50 },
          { pool: "0xdelisted", weightPct: 50 },
        ],
        permanent: true,
        expiresAt: 0,
      },
    ]);

    const body = await (await call(`?address=${ADDRESS}`)).json();

    // The "stay" side can't account for the delisted pool, so deltaUsd is
    // biased toward switching by exactly that unmeasured amount. A caller
    // acting automatically has to be told.
    expect(body.comparable).toBe(false);
    expect(body.unpricedPools).toEqual(["0xdelisted"]);
  });

  it("reports hasVoted false for a lock that hasn't voted this epoch", async () => {
    stubConfigured();
    fetchAccountLocks.mockResolvedValue([
      { tokenId: "1", votingPower: 10_000, votes: [], permanent: true, expiresAt: 0 },
    ]);

    const body = await (await call(`?address=${ADDRESS}`)).json();

    expect(body.hasVoted).toBe(false);
    expect(body.estimateIfStayUsd).toBe(0);
  });

  it("logs x402 usage under its own route name after serving a paid request", async () => {
    stubConfigured();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await call(`?address=${ADDRESS}`);

    const line = logSpy.mock.calls.map((c) => c[0] as string).find((l) => l.includes("x402_request_served"));
    expect(line).toBeDefined();
    expect(JSON.parse(line!)).toMatchObject({ route: "v1/position", priceUsd: 0.05, votingPower: 10_000 });
  });

  it("does not log usage when the chain read fails (never billed, never logged)", async () => {
    stubConfigured();
    fetchAccountLocks.mockRejectedValueOnce(new Error("RPC down"));
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await call(`?address=${ADDRESS}`);

    expect(res.status).toBe(500);
    expect(logSpy.mock.calls.map((c) => c[0] as string).find((l) => l.includes("x402_request_served"))).toBeUndefined();
  });
});
