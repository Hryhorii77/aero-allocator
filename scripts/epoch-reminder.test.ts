import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// epoch-reminder.ts is a top-level, auto-executing script (run via `tsx`,
// never imported elsewhere) — so testing it means importing the real file
// with its dependencies mocked at the module boundary and observing what
// it actually did (console output, fetch calls, log writes), the same way
// running it for real would be observed. Each scenario needs a fresh
// module (vi.resetModules + a fresh dynamic import) since the whole file
// body runs once, at import time, and vi.doMock (not the hoisted vi.mock)
// so mock behavior can vary per test.
const WEEK = 604800;

function makeForecast(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    pool: { lp: "0xpool1", symbol: "TEST/USDC", gaugeAlive: true },
    predictedFeesUsd: 1000,
    predictiveEdge: 0.05,
    confidence: 0.7,
    ...overrides,
  };
}

function mockConfig(hoursLeft: number, epochProgressPct = 0.85) {
  vi.doMock("../src/config.js", () => ({
    WEEK,
    PROTOCOL: "aerodrome",
    currentEpochStart: () => Math.floor(Date.now() / 1000) - WEEK + hoursLeft * 3600,
    epochProgress: () => epochProgressPct,
  }));
}

function mockScoring(opts: {
  forecasts?: unknown[];
  risers?: unknown[];
  fallers?: unknown[];
  recommendAllocation?: (snap: unknown, objective: string, maxPools: number, votingPower?: number) => unknown;
} = {}) {
  const forecasts = opts.forecasts ?? [makeForecast()];
  const recommendAllocation =
    opts.recommendAllocation ??
    ((snap: unknown, objective: string, maxPools: number, votingPower?: number) => ({
      summary: `${objective} summary`,
      allocations:
        objective === "voter_roi"
          ? [{ pool: "0xpool1", symbol: "TEST/USDC", weightPct: 100, expectedRewardUsd: 42.5 }]
          : [{ pool: "0xpool1", symbol: "TEST/USDC", weightPct: 100 }],
    }));

  vi.doMock("../src/scoring.js", () => ({
    getMarketSnapshot: vi.fn(async () => ({ generatedAt: 1, forecasts })),
    detectVoteSwings: vi.fn(() => ({ risers: opts.risers ?? [], fallers: opts.fallers ?? [] })),
    recommendAllocation: vi.fn(recommendAllocation),
  }));
}

const upsertRecommendationLog = vi.fn();
function mockTrackingLog() {
  vi.doMock("../src/tracking-log.js", () => ({ upsertRecommendationLog }));
}

// process.exit(0) is the script's last line — a plain no-op mock wouldn't
// stop execution there the way the real thing does (this is top-level
// script code, not a function body, so there's no `return` to fall back
// on). It happens to be harmless here since nothing follows that line, but
// throwing is the faithful simulation of process.exit's control-flow
// effect — see the more detailed note in realized-performance.test.ts,
// where this actually matters (multiple exit points).
class ProcessExitCalled extends Error {
  constructor(public code: number) {
    super(`process.exit(${code})`);
  }
}

let logSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;
let exitSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.resetModules();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  upsertRecommendationLog.mockClear();
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  exitSpy = vi.spyOn(process, "exit").mockImplementation((code?: string | number | null) => {
    throw new ProcessExitCalled(Number(code ?? 0));
  });
});

afterEach(() => {
  logSpy.mockRestore();
  errorSpy.mockRestore();
  exitSpy.mockRestore();
});

function loggedLines(): string {
  return logSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("\n");
}

async function runScript(): Promise<void> {
  await expect(import("./epoch-reminder.js")).rejects.toThrow(ProcessExitCalled);
}

describe("scripts/epoch-reminder", () => {
  it("prints epoch progress and mispricings, exits cleanly, without a voting power or webhook set", async () => {
    mockConfig(20);
    mockScoring({ forecasts: [makeForecast({ pool: { lp: "0xpool1", symbol: "TEST/USDC", gaugeAlive: true } })] });
    mockTrackingLog();
    vi.stubGlobal("fetch", vi.fn());

    await runScript();

    expect(loggedLines()).toContain("Epoch 85.0% elapsed");
    expect(loggedLines()).toContain("TEST/USDC");
    expect(upsertRecommendationLog).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it("excludes forecasts for gauges that are dead or have zero confidence from the mispricing list", async () => {
    mockConfig(20);
    mockScoring({
      forecasts: [
        makeForecast({ pool: { lp: "0xdead", symbol: "DEAD/GAUGE", gaugeAlive: false } }),
        makeForecast({ pool: { lp: "0xnoconf", symbol: "NO/CONFIDENCE" }, confidence: 0 }),
        makeForecast({ pool: { lp: "0xok", symbol: "OK/POOL", gaugeAlive: true }, confidence: 0.5 }),
      ],
    });
    mockTrackingLog();
    vi.stubGlobal("fetch", vi.fn());

    await runScript();

    expect(loggedLines()).toContain("OK/POOL");
    expect(loggedLines()).not.toContain("DEAD/GAUGE");
    expect(loggedLines()).not.toContain("NO/CONFIDENCE");
  });

  it("logs a personal voter_roi recommendation when AERO_VOTING_POWER is set, with correctly computed votes/rewards", async () => {
    vi.stubEnv("AERO_VOTING_POWER", "10000");
    mockConfig(20);
    mockScoring({
      recommendAllocation: (snap, objective) =>
        objective === "voter_roi"
          ? {
              summary: "voter_roi summary",
              allocations: [
                { pool: "0xpool1", symbol: "TEST/USDC", weightPct: 33.333, expectedRewardUsd: 12.345 },
              ],
            }
          : { summary: "protocol_efficiency summary", allocations: [] },
    });
    mockTrackingLog();
    vi.stubGlobal("fetch", vi.fn());

    await runScript();

    expect(upsertRecommendationLog).toHaveBeenCalledTimes(1);
    const entry = upsertRecommendationLog.mock.calls[0][0];
    expect(entry.protocol).toBe("aerodrome");
    expect(entry.votingPowerVe).toBe(10000);
    // 10000 * 33.333% = 3333.3, rounded to 2dp.
    expect(entry.allocations[0].votesAllocated).toBe(3333.3);
    expect(entry.allocations[0].expectedRewardUsd).toBe(12.345);
    expect(entry.totalExpectedRewardUsd).toBe(12.35); // rounded sum
    expect(loggedLines()).toContain("Logged to data/voter-roi-log.jsonl");
  });

  it("does not compute or log a personal vote when AERO_VOTING_POWER is unset or non-positive", async () => {
    vi.stubEnv("AERO_VOTING_POWER", "0");
    mockConfig(20);
    mockScoring();
    mockTrackingLog();
    vi.stubGlobal("fetch", vi.fn());

    await runScript();

    expect(upsertRecommendationLog).not.toHaveBeenCalled();
    expect(loggedLines()).not.toContain("Your vote");
  });

  it("posts a Discord embed when AERO_DISCORD_WEBHOOK_URL is set, amber when not urgent", async () => {
    vi.stubEnv("AERO_DISCORD_WEBHOOK_URL", "https://discord.example/webhook");
    mockConfig(20); // > 6h left -> not urgent
    mockScoring();
    mockTrackingLog();
    const fetchMock = vi.fn(async (_url?: string | URL | Request, _init?: RequestInit) => ({ ok: true, status: 200 }) as Response);
    vi.stubGlobal("fetch", fetchMock);

    await runScript();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://discord.example/webhook");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.embeds[0].title).toContain("flips in 20.0h");
    expect(body.embeds[0].color).toBe(0xf39c12); // amber, not urgent
    expect(body.embeds[0].fields.some((f: { name: string }) => f.name.startsWith("Your vote"))).toBe(false); // no voting power was set
    expect(loggedLines()).toContain("Posted summary to Discord.");
  });

  it("uses the urgent (red) color and includes a one-click vote link when close to lock with voting power + dashboard URL set", async () => {
    vi.stubEnv("AERO_DISCORD_WEBHOOK_URL", "https://discord.example/webhook");
    vi.stubEnv("AERO_VOTING_POWER", "5000");
    vi.stubEnv("AERO_DASHBOARD_URL", "https://dashboard.example/");
    mockConfig(3); // <= 6h left -> urgent
    mockScoring({
      recommendAllocation: (snap, objective) =>
        objective === "voter_roi"
          ? { summary: "voter_roi", allocations: [{ pool: "0xpool1", symbol: "TEST/USDC", weightPct: 100, expectedRewardUsd: 5 }] }
          : { summary: "protocol_efficiency", allocations: [] },
    });
    mockTrackingLog();
    const fetchMock = vi.fn(async (_url?: string | URL | Request, _init?: RequestInit) => ({ ok: true, status: 200 }) as Response);
    vi.stubGlobal("fetch", fetchMock);

    await runScript();

    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.embeds[0].color).toBe(0xe74c3c); // urgent red
    // Trailing slash on AERO_DASHBOARD_URL is stripped before the query param.
    expect(body.embeds[0].url).toBe("https://dashboard.example/?vp=5000");
    expect(body.embeds[0].fields.some((f: { name: string }) => f.name.startsWith("Your vote"))).toBe(true);
  });

  it("logs an error (not a crash) when the Discord webhook responds non-OK", async () => {
    vi.stubEnv("AERO_DISCORD_WEBHOOK_URL", "https://discord.example/webhook");
    mockConfig(20);
    mockScoring();
    mockTrackingLog();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 500, text: async () => "server error" }) as Response),
    );

    await runScript();

    const errors = errorSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("\n");
    expect(errors).toContain("Discord webhook failed: HTTP 500");
    expect(exitSpy).toHaveBeenCalledWith(0); // still exits cleanly, doesn't crash the script
  });

  it("logs an error (not a crash) when the Discord webhook request throws", async () => {
    vi.stubEnv("AERO_DISCORD_WEBHOOK_URL", "https://discord.example/webhook");
    mockConfig(20);
    mockScoring();
    mockTrackingLog();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );

    await runScript();

    const errors = errorSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("\n");
    expect(errors).toContain("Discord webhook failed: network down");
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it("includes risers and fallers sections only when present", async () => {
    mockConfig(20);
    mockScoring({
      risers: [{ symbol: "RISER/POOL", bribeSpikeRatio: 3, currentBribesUsd: 500, voteSwingPct: 12 }],
      fallers: [],
    });
    mockTrackingLog();
    vi.stubGlobal("fetch", vi.fn());

    await runScript();

    expect(loggedLines()).toContain("Bribes running ahead of pace");
    expect(loggedLines()).toContain("RISER/POOL");
    expect(loggedLines()).not.toContain("Votes running behind pace");
  });
});
