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
vi.mock("@x402/next", () => ({
  withX402: vi.fn(),
  x402ResourceServer: class {
    register() {
      return this;
    }
  },
}));

// x402Configured (route.ts) is computed once at module-load time from
// process.env, so each scenario needs a fresh module import with the env
// stubbed before that import happens.
beforeEach(() => {
  vi.resetModules();
  vi.unstubAllEnvs();
});
afterEach(() => {
  vi.unstubAllEnvs();
});

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
});
