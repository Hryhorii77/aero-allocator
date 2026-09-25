import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { withX402 } from "@x402/next";

// Same module-boundary mock as the sibling paid-route tests: @x402/next's
// dist build can't be resolved by Vitest, and what's under test is this
// route's own validation, error mapping and usage logging. Identity-wrapping
// withX402 lets the "configured" cases invoke the handler.
vi.mock("@x402/next", () => ({
  withX402: vi.fn((handler: unknown) => handler),
  x402ResourceServer: class {
    register() {
      return this;
    }
  },
}));

const { calibratedSnapshot, minimumBribeForTarget } = vi.hoisted(() => ({
  calibratedSnapshot: vi.fn(),
  minimumBribeForTarget: vi.fn(),
}));
vi.mock("@/lib/snapshot", () => ({ calibratedSnapshot }));
vi.mock("aero-allocator/bribe-target", () => ({ minimumBribeForTarget }));

const PAYTO = "0x1234567890123456789012345678901234567890";
const POOL = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd";

beforeEach(() => {
  vi.resetModules();
  vi.unstubAllEnvs();
  calibratedSnapshot.mockReset().mockResolvedValue({ generatedAt: 1_700_000_000_000, forecasts: [] });
  minimumBribeForTarget.mockReset().mockReturnValue({ pool: POOL, symbol: "A/USDC", feasible: true, minBribeUsd: 1234.5, basis: "a floor" });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function stubConfigured() {
  vi.stubEnv("X402_PAYTO_ADDRESS", PAYTO);
  vi.stubEnv("CDP_API_KEY_ID", "some-id");
  vi.stubEnv("CDP_API_KEY_SECRET", "some-secret");
}

const call = async (query: string) => {
  const { GET } = await import("./route");
  return GET(new NextRequest(`http://localhost/api/v1/bribe-target${query}`));
};

describe("GET /api/v1/bribe-target", () => {
  it("serves a clear 501 (not a crash) when x402 env is unconfigured", async () => {
    vi.stubEnv("X402_PAYTO_ADDRESS", "");
    vi.stubEnv("CDP_API_KEY_ID", "");
    vi.stubEnv("CDP_API_KEY_SECRET", "");
    const res = await call(`?pool=${POOL}&targetSharePct=5`);
    expect(res.status).toBe(501);
    expect((await res.json()).error).toMatch(/X402_PAYTO_ADDRESS/);
  });

  it("describes itself in grammatical, protocol-neutral words to the payment layer", async () => {
    stubConfigured();
    await import("./route");
    const config = (withX402 as unknown as { mock: { calls: unknown[][] } }).mock.calls.at(-1)![1] as {
      accepts: { price: string };
      description: string;
    };
    // Agents read this in the 402 challenge before deciding to pay.
    expect(config.accepts.price).toBe("$0.1");
    expect(config.description).toMatch(/^The least bribe that could move a pool on \w+ to a target share of all votes/);
    expect(config.description).not.toMatch(/\ba [AEIOU]/); // "a Aerodrome"
    expect(config.description).toMatch(/floor/i);
  });

  it("rejects a missing or malformed pool, or a target that isn't a share, with 400 before any snapshot work", async () => {
    stubConfigured();
    for (const q of [
      "",
      "?targetSharePct=5",
      "?pool=nonsense&targetSharePct=5",
      `?pool=${POOL}`,
      `?pool=${POOL}&targetSharePct=0`,
      `?pool=${POOL}&targetSharePct=-3`,
      `?pool=${POOL}&targetSharePct=101`,
      `?pool=${POOL}&targetSharePct=abc`,
    ]) {
      expect((await call(q)).status).toBe(400);
    }
    // 400 short-circuits settlement in withX402: a typo is never billed.
    expect(calibratedSnapshot).not.toHaveBeenCalled();
    expect(minimumBribeForTarget).not.toHaveBeenCalled();
  });

  it("returns 404 (uncharged) for a pool that isn't an eligible gauge in this snapshot", async () => {
    stubConfigured();
    minimumBribeForTarget.mockImplementation(() => {
      throw new Error("Pool 0xabc is not an eligible gauge-alive pool in the current snapshot.");
    });
    const res = await call(`?pool=${POOL}&targetSharePct=5`);
    expect(res.status).toBe(404);
    expect((await res.json()).error).toMatch(/not an eligible/);
  });

  it("passes the checksummed pool and the target to the engine, and returns its answer with a timestamp", async () => {
    stubConfigured();
    const res = await call(`?pool=${POOL}&targetSharePct=7.5`);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(minimumBribeForTarget).toHaveBeenCalledWith(expect.anything(), expect.stringMatching(/^0x[0-9a-fA-F]{40}$/), 7.5);
    expect(minimumBribeForTarget.mock.calls[0][1].toLowerCase()).toBe(POOL);
    expect(body).toMatchObject({ minBribeUsd: 1234.5, basis: "a floor", generatedAt: "2023-11-14T22:13:20.000Z" });
  });

  it("logs the served call under its own price and params, not a voting power", async () => {
    stubConfigured();
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    await call(`?pool=${POOL}&targetSharePct=5`);
    const logged = JSON.parse(spy.mock.calls[0][0] as string);
    expect(logged).toMatchObject({ event: "x402_request_served", route: "v1/bribe-target", priceUsd: 0.1 });
    expect(logged.params).toMatchObject({ targetSharePct: 5 });
    expect(logged).not.toHaveProperty("votingPower");
  });
});
