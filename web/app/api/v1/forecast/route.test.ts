import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

// @x402/next's dist build does an extensionless `import ... from
// "next/server"` that Vitest's ESM resolver can't follow (works fine for
// our own route files' `next/server` imports — this is specific to how
// that package's dist output resolves the nested `next` dependency). We're
// testing our own env-gating logic here, not the third-party payment
// library's internals, so mocking the module boundary is the right fix
// rather than fighting Vite resolution config for a dependency we don't
// control.
// withX402 is mocked as an identity wrapper (returns the handler
// unchanged) rather than a bare vi.fn() so the "configured" tests below
// can actually invoke GET and exercise the wrapped handler — we're
// testing our own route logic (usage logging, forecast building), not
// x402's real payment verification/settlement.
vi.mock("@x402/next", () => ({
  withX402: vi.fn((handler: unknown) => handler),
  x402ResourceServer: class {
    register() {
      return this;
    }
  },
}));

const { buildFullForecast } = vi.hoisted(() => ({
  buildFullForecast: vi.fn(async (votingPower: number, refresh: boolean) => ({ votingPower, refresh })),
}));
vi.mock("@/lib/snapshot", () => ({ buildFullForecast }));

// x402Configured (route.ts) is computed once at module-load time from
// process.env, so each scenario needs a fresh module import with the env
// stubbed before that import happens.
beforeEach(() => {
  vi.resetModules();
  vi.unstubAllEnvs();
  buildFullForecast.mockClear();
});
afterEach(() => {
  vi.unstubAllEnvs();
});

function stubConfigured() {
  vi.stubEnv("X402_PAYTO_ADDRESS", "0x1234567890123456789012345678901234567890");
  vi.stubEnv("CDP_API_KEY_ID", "some-id");
  vi.stubEnv("CDP_API_KEY_SECRET", "some-secret");
}

describe("GET /api/v1/forecast", () => {
  it("serves a clear 501 (not a crash) when x402 env is unconfigured", async () => {
    vi.stubEnv("X402_PAYTO_ADDRESS", "");
    vi.stubEnv("CDP_API_KEY_ID", "");
    vi.stubEnv("CDP_API_KEY_SECRET", "");
    const { GET } = await import("./route");

    const res = await GET(new NextRequest("http://localhost/api/v1/forecast"));
    expect(res.status).toBe(501);
    const body = await res.json();
    expect(body.error).toMatch(/X402_PAYTO_ADDRESS/);
  });

  it("stays unconfigured (501) if only some of the three required env vars are set", async () => {
    vi.stubEnv("X402_PAYTO_ADDRESS", "0x1234567890123456789012345678901234567890");
    vi.stubEnv("CDP_API_KEY_ID", "");
    vi.stubEnv("CDP_API_KEY_SECRET", "");
    const { GET } = await import("./route");

    const res = await GET(new NextRequest("http://localhost/api/v1/forecast"));
    expect(res.status).toBe(501);
  });

  it("degrades to 501 (not a module-load crash) when X402_PAYTO_ADDRESS is set but malformed", async () => {
    vi.stubEnv("X402_PAYTO_ADDRESS", "0x1234"); // too short to be a real address
    vi.stubEnv("CDP_API_KEY_ID", "some-id");
    vi.stubEnv("CDP_API_KEY_SECRET", "some-secret");
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { GET } = await import("./route");
    const res = await GET(new NextRequest("http://localhost/api/v1/forecast"));

    expect(res.status).toBe(501);
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("logs x402 usage after successfully serving a configured, paid request", async () => {
    stubConfigured();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const { GET } = await import("./route");
    const res = await GET(new NextRequest("http://localhost/api/v1/forecast?votingPower=5000&refresh=1"));

    expect(res.status).toBe(200);
    expect(buildFullForecast).toHaveBeenCalledWith(5000, true);
    const usageLog = logSpy.mock.calls.map((c) => c[0] as string).find((line) => line.includes("x402_request_served"));
    expect(usageLog).toBeDefined();
    expect(JSON.parse(usageLog!)).toMatchObject({
      event: "x402_request_served",
      route: "v1/forecast",
      priceUsd: 0.05,
      refresh: true,
      votingPower: 5000,
    });
    logSpy.mockRestore();
  });

  it("does not log usage when the forecast build fails (matches: never billed, never logged)", async () => {
    stubConfigured();
    buildFullForecast.mockRejectedValueOnce(new Error("RPC down"));
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});

    const { GET } = await import("./route");
    const res = await GET(new NextRequest("http://localhost/api/v1/forecast"));

    expect(res.status).toBe(500);
    const usageLog = logSpy.mock.calls.map((c) => c[0] as string).find((line) => line.includes("x402_request_served"));
    expect(usageLog).toBeUndefined();
    logSpy.mockRestore();
    vi.restoreAllMocks();
  });
});
