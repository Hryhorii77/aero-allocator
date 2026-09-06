import { describe, expect, it, vi, beforeEach } from "vitest";
import type { MarketSnapshot } from "aero-allocator/scoring";
import type { BacktestReport } from "aero-allocator/backtest";

const { getMarketSnapshot, getBacktestReport, put, getBlob, after } = vi.hoisted(() => ({
  getMarketSnapshot: vi.fn(async (_force?: boolean) => ({ generatedAt: 1, forecasts: [] }) as MarketSnapshot),
  getBacktestReport: vi.fn(async () => ({ confidenceCalibration: [] }) as unknown as BacktestReport),
  put: vi.fn(async (_pathname: string, _body: unknown, _options: unknown) => ({}) as unknown),
  getBlob: vi.fn(async (_pathname: string, _options: unknown) => null as unknown),
  // Real after() extends the serverless invocation past the response using
  // Vercel's waitUntil — outside that request scope (e.g. here) it throws.
  // The mock just records the callback so tests can await it explicitly,
  // deterministically, instead of racing microtask timing.
  after: vi.fn((_cb: () => unknown) => {}),
}));

vi.mock("aero-allocator/scoring", async (importOriginal) => ({
  ...(await importOriginal<typeof import("aero-allocator/scoring")>()),
  getMarketSnapshot,
}));
vi.mock("aero-allocator/backtest", async (importOriginal) => ({
  ...(await importOriginal<typeof import("aero-allocator/backtest")>()),
  getBacktestReport,
}));
vi.mock("@vercel/blob", () => ({ put, get: getBlob }));
vi.mock("next/server", () => ({ after }));

import { getDurableMarketSnapshot, calibratedSnapshot } from "./snapshot";

const SNAPSHOT_PATHNAME = "market-snapshot-cache.json";
const BACKTEST_PATHNAME = "backtest-report-cache.json";

function blobResult(payload: unknown) {
  return { statusCode: 200, stream: new Response(JSON.stringify(payload)).body };
}

// Awaits whatever background-refresh work the most recent after() call
// scheduled, so a stale-hit test can assert on the write it triggers
// without depending on real timing.
async function flushBackgroundRefresh() {
  const scheduled = after.mock.calls.at(-1)?.[0] as (() => unknown) | undefined;
  await scheduled?.();
}

beforeEach(() => {
  getMarketSnapshot.mockClear();
  getBacktestReport.mockClear();
  put.mockClear();
  getBlob.mockReset();
  getBlob.mockResolvedValue(null);
  after.mockClear();
});

describe("getDurableMarketSnapshot", () => {
  it("returns the blob's cached snapshot without rebuilding when it's still fresh", async () => {
    const cachedSnapshot: MarketSnapshot = { generatedAt: 99, forecasts: [] };
    getBlob.mockResolvedValue(blobResult({ cachedAt: Date.now() - 1000, data: cachedSnapshot }));

    const result = await getDurableMarketSnapshot();

    expect(result).toEqual(cachedSnapshot);
    expect(getMarketSnapshot).not.toHaveBeenCalled();
    expect(after).not.toHaveBeenCalled();
  });

  it("serves an expired entry immediately (stale-while-revalidate) instead of blocking on a rebuild", async () => {
    const staleSnapshot: MarketSnapshot = { generatedAt: 1, forecasts: [] };
    // Far older than SETTINGS.cacheTtlMs (5 minutes) — this is exactly the
    // case Grok round 6 caught live: a visit ~38 minutes after the last one
    // still cold-started, because a bare TTL always makes the first visitor
    // after it lapses pay full price no matter how it's set.
    getBlob.mockResolvedValue(blobResult({ cachedAt: Date.now() - 60 * 60 * 1000, data: staleSnapshot }));

    const result = await getDurableMarketSnapshot();

    // The stale value comes back right away — no request ever waits on a
    // rebuild once a blob has been written at least once.
    expect(result).toEqual(staleSnapshot);

    // A refresh was scheduled to run after the response, via after(); once
    // it completes, the fresh result is written back for the next request.
    expect(after).toHaveBeenCalledTimes(1);
    await flushBackgroundRefresh();
    expect(getMarketSnapshot).toHaveBeenCalledTimes(1);
    expect(put).toHaveBeenCalledWith(SNAPSHOT_PATHNAME, expect.any(String), expect.anything());
  });

  it("coalesces concurrent background refreshes instead of rebuilding once per stale request", async () => {
    // mockImplementation (not mockResolvedValue) so each call gets its own
    // fresh Response/stream — getDurableMarketSnapshot is called twice
    // below, and a stream can only be read once.
    getBlob.mockImplementation(async () => blobResult({ cachedAt: Date.now() - 60 * 60 * 1000, data: { generatedAt: 1, forecasts: [] } }));
    // Held open deliberately: both calls below must land while refresh #1 is
    // still in flight, otherwise this can't actually exercise coalescing —
    // a rebuild that resolved immediately might already have cleared
    // in-flight state before the second call checks it.
    let resolveRebuild!: (v: MarketSnapshot) => void;
    getMarketSnapshot.mockReturnValueOnce(new Promise((resolve) => (resolveRebuild = resolve)));

    await getDurableMarketSnapshot(); // schedules refresh #1 (still pending)
    await getDurableMarketSnapshot(); // sees refresh #1 in flight, skips scheduling a second

    resolveRebuild({ generatedAt: 2, forecasts: [] });
    // Both calls' after() callbacks point at the same in-flight promise —
    // flushing either should only trigger one rebuild.
    await flushBackgroundRefresh();

    expect(getMarketSnapshot).toHaveBeenCalledTimes(1);
  });

  it("does not fail the request when a background refresh itself throws", async () => {
    getBlob.mockResolvedValue(blobResult({ cachedAt: Date.now() - 60 * 60 * 1000, data: { generatedAt: 1, forecasts: [] } }));
    getMarketSnapshot.mockRejectedValueOnce(new Error("RPC down"));

    const result = await getDurableMarketSnapshot();
    await expect(flushBackgroundRefresh()).resolves.toBeUndefined();

    expect(result).toEqual({ generatedAt: 1, forecasts: [] });
    expect(put).not.toHaveBeenCalled();
  });

  it("falls back to a live rebuild when the blob store isn't configured (read throws)", async () => {
    getBlob.mockRejectedValue(new Error("no BLOB_READ_WRITE_TOKEN"));

    const result = await getDurableMarketSnapshot();

    expect(getMarketSnapshot).toHaveBeenCalledTimes(1);
    expect(result).toEqual(await getMarketSnapshot.mock.results[0].value);
  });

  it("does not fail the request when the write-back to blob throws", async () => {
    put.mockRejectedValue(new Error("write failed"));

    const result = await getDurableMarketSnapshot();

    expect(result).toEqual(await getMarketSnapshot.mock.results[0].value);
  });

  it("treats a blob written under an older cache shape as a miss instead of returning undefined data", async () => {
    // Regression test: this exact shape (an old field name instead of
    // `data`) crashed a live request during development — parsed fine, but
    // handed back `data: undefined`, which the caller trusted and
    // dereferenced straight into a TypeError.
    getBlob.mockResolvedValue(blobResult({ cachedAt: Date.now() - 1000, snapshot: { generatedAt: 1, forecasts: [] } }));

    const result = await getDurableMarketSnapshot();

    expect(getMarketSnapshot).toHaveBeenCalledTimes(1);
    expect(result).toEqual(await getMarketSnapshot.mock.results[0].value);
  });

  it("bypasses the blob cache entirely on refresh, but still writes the fresh result back", async () => {
    const cachedSnapshot: MarketSnapshot = { generatedAt: 99, forecasts: [] };
    getBlob.mockResolvedValue(blobResult({ cachedAt: Date.now(), data: cachedSnapshot }));

    await getDurableMarketSnapshot(true);

    expect(getBlob).not.toHaveBeenCalled();
    expect(getMarketSnapshot).toHaveBeenCalledWith(true);
    expect(put).toHaveBeenCalledTimes(1);
  });
});

describe("calibratedSnapshot's durable backtest cache", () => {
  // getBacktestReport's own walk-forward replay is a second, independent
  // RPC-bound cost from the live snapshot's — a live check against the
  // real deployment showed a fresh instance still taking ~48s even after
  // the snapshot side was served from its blob cache, because this half
  // had no durable cache yet.
  it("reuses a fresh cached backtest report instead of recomputing it", async () => {
    const cachedReport = { confidenceCalibration: [{ min: 0, max: 1, n: 1, wape: 0.1, calibratedConfidence: 0.9 }] };
    getBlob.mockImplementation(async (pathname: string) => {
      if (pathname === BACKTEST_PATHNAME) return blobResult({ cachedAt: Date.now() - 1000, data: cachedReport });
      return null;
    });

    await calibratedSnapshot();

    expect(getBacktestReport).not.toHaveBeenCalled();
  });

  it("serves an expired backtest report immediately and refreshes it in the background", async () => {
    const staleReport = { confidenceCalibration: [] };
    getBlob.mockImplementation(async (pathname: string) => {
      // Far older than SETTINGS.backtestCacheTtlMs (1 hour).
      if (pathname === BACKTEST_PATHNAME) return blobResult({ cachedAt: Date.now() - 2 * 60 * 60 * 1000, data: staleReport });
      return null;
    });

    await calibratedSnapshot();

    await flushBackgroundRefresh();
    expect(getBacktestReport).toHaveBeenCalledTimes(1);
    expect(put).toHaveBeenCalledWith(BACKTEST_PATHNAME, expect.any(String), expect.anything());
  });
});
