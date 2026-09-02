import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// Same rationale as epoch-reminder.test.ts: this is a top-level,
// auto-executing script, so each scenario gets a fresh module import with
// its dependencies mocked via vi.doMock (not the hoisted vi.mock, so
// per-test mock data is possible) beforehand.
//
// This script (unlike epoch-reminder.ts) has THREE process.exit(0) calls —
// two early-return guards plus one at the very end — none of which is a
// real `return` statement, since this is top-level script code, not a
// function body. A plain no-op process.exit mock doesn't stop execution
// the way the real thing does, so a "log is empty" scenario would
// silently keep running straight through the later branches too,
// producing misleading passes. Throwing from the mock (and asserting the
// resulting import() rejection) reproduces process.exit's real
// short-circuiting effect on control flow.
class ProcessExitCalled extends Error {
  constructor(public code: number) {
    super(`process.exit(${code})`);
  }
}

function mockTrackingLog(log: unknown[]) {
  vi.doMock("../src/tracking-log.js", () => ({ readRecommendationLog: () => log }));
}

function mockScoring() {
  vi.doMock("../src/scoring.js", () => ({ getMarketSnapshot: vi.fn(async () => ({ generatedAt: 1, forecasts: [] })) }));
}

function mockTracking(results: unknown[]) {
  vi.doMock("../src/tracking.js", () => ({ computeRealizedPerformance: vi.fn(() => results) }));
}

let logSpy: ReturnType<typeof vi.spyOn>;
let exitSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.resetModules();
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  exitSpy = vi.spyOn(process, "exit").mockImplementation((code?: string | number | null) => {
    throw new ProcessExitCalled(Number(code ?? 0));
  });
});

afterEach(() => {
  logSpy.mockRestore();
  exitSpy.mockRestore();
});

function loggedLines(): string {
  return logSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("\n");
}

// Every code path through this script ends in process.exit(0), so every
// import is expected to "reject" via the mock's throw — that's success,
// not a real error. Only a rejection with some OTHER error indicates an
// actual bug in the script.
async function runScript(): Promise<void> {
  await expect(import("./realized-performance.js")).rejects.toThrow(ProcessExitCalled);
}

describe("scripts/realized-performance", () => {
  it("reports nothing logged yet and exits before building a snapshot, when the log is empty", async () => {
    mockTrackingLog([]);
    mockScoring();
    mockTracking([]);

    await runScript();

    expect(loggedLines()).toContain("No logged recommendations yet");
    expect(exitSpy).toHaveBeenCalledTimes(1);
    expect(exitSpy).toHaveBeenCalledWith(0);
    const { getMarketSnapshot } = await import("../src/scoring.js");
    expect(getMarketSnapshot).not.toHaveBeenCalled();
  });

  it("reports pending-but-not-yet-completed epochs, then exits, when the log has entries but none reconcile", async () => {
    const WEEK = 7 * 24 * 60 * 60;
    const futureEpoch = Math.floor(Date.now() / 1000) + WEEK; // still within its epoch, not completed
    mockTrackingLog([{ epochStart: futureEpoch, protocol: "aerodrome", votingPowerVe: 1000, allocations: [], totalExpectedRewardUsd: 0 }]);
    mockScoring();
    mockTracking([]);

    await runScript();

    expect(loggedLines()).toContain("1 logged recommendation(s), none completed yet");
    expect(loggedLines()).toContain("1 still pending");
    expect(exitSpy).toHaveBeenCalledTimes(1);
  });

  it("prints per-epoch and overall predicted-vs-realized numbers when results reconcile", async () => {
    mockTrackingLog([{ epochStart: 1_700_000_000, protocol: "aerodrome", votingPowerVe: 10000, allocations: [], totalExpectedRewardUsd: 100 }]);
    mockScoring();
    mockTracking([
      {
        epochStart: 1_700_000_000,
        protocol: "aerodrome",
        votingPowerVe: 10000,
        totalExpectedRewardUsd: 100,
        totalRealizedRewardUsd: 120,
        skillPct: 20,
        pools: [
          { pool: "0x1", symbol: "POOL-A", votesAllocated: 5000, expectedRewardUsd: 60, realizedRewardUsd: 70 },
          { pool: "0x2", symbol: "POOL-B", votesAllocated: 5000, expectedRewardUsd: 40, realizedRewardUsd: null },
        ],
      },
    ]);

    await runScript();

    const out = loggedLines();
    expect(out).toContain("1 completed epoch(s) reconciled");
    expect(out).toContain("10,000 veAERO");
    expect(out).toContain("predicted $  100.00");
    expect(out).toContain("realized $  120.00");
    expect(out).toContain("skill +20.0%");
    expect(out).toContain("POOL-A");
    expect(out).toContain("$70.00");
    expect(out).toContain("POOL-B");
    expect(out).toContain("n/a (rolled off history)");
    expect(out).toContain("Overall: predicted $100.00, realized $120.00 (+20.0%)");
    // Only the final, "everything reconciled" exit should fire — not the
    // earlier empty-log/none-completed guards too.
    expect(exitSpy).toHaveBeenCalledTimes(1);
  });

  it("sums predicted/realized correctly across multiple completed epochs", async () => {
    mockTrackingLog([{ epochStart: 1, protocol: "aerodrome", votingPowerVe: 1, allocations: [], totalExpectedRewardUsd: 0 }]);
    mockScoring();
    mockTracking([
      {
        epochStart: 1_700_000_000,
        protocol: "aerodrome",
        votingPowerVe: 1000,
        totalExpectedRewardUsd: 50,
        totalRealizedRewardUsd: 40,
        skillPct: -20,
        pools: [],
      },
      {
        epochStart: 1_700_604_800,
        protocol: "aerodrome",
        votingPowerVe: 1000,
        totalExpectedRewardUsd: 50,
        totalRealizedRewardUsd: 70,
        skillPct: 40,
        pools: [],
      },
    ]);

    await runScript();

    // 50+50 predicted, 40+70 realized -> overall (110-100)/100 = +10%.
    expect(loggedLines()).toContain("Overall: predicted $100.00, realized $110.00 (+10.0%)");
    expect(exitSpy).toHaveBeenCalledTimes(1);
  });
});
