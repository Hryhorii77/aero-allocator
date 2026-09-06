import { describe, expect, it, vi, beforeEach } from "vitest";
import type { MarketSnapshot } from "aero-allocator/scoring";
import type { BacktestReport } from "aero-allocator/backtest";

const { getMarketSnapshot, getBacktestReport, put, getBlob } = vi.hoisted(() => ({
  getMarketSnapshot: vi.fn(async (_force?: boolean) => ({ generatedAt: 1, forecasts: [] }) as MarketSnapshot),
  getBacktestReport: vi.fn(async () => ({ confidenceCalibration: [] }) as unknown as BacktestReport),
  put: vi.fn(async (_pathname: string, _body: unknown, _options: unknown) => ({}) as unknown),
  getBlob: vi.fn(async (_pathname: string, _options: unknown) => null as unknown),
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

import { getDurableMarketSnapshot, calibratedSnapshot } from "./snapshot";

const SNAPSHOT_PATHNAME = "market-snapshot-cache.json";
const BACKTEST_PATHNAME = "backtest-report-cache.json";

function blobResult(payload: unknown) {
  return { statusCode: 200, stream: new Response(JSON.stringify(payload)).body };
}

beforeEach(() => {
  getMarketSnapshot.mockClear();
  getBacktestReport.mockClear();
  put.mockClear();
  getBlob.mockReset();
  getBlob.mockResolvedValue(null);
});

describe("getDurableMarketSnapshot", () => {
  it("returns the blob's cached snapshot without rebuilding when it's still fresh", async () => {
    const cachedSnapshot: MarketSnapshot = { generatedAt: 99, forecasts: [] };
    getBlob.mockResolvedValue(blobResult({ cachedAt: Date.now() - 1000, data: cachedSnapshot }));

    const result = await getDurableMarketSnapshot();

    expect(result).toEqual(cachedSnapshot);
    expect(getMarketSnapshot).not.toHaveBeenCalled();
  });

  it("rebuilds and writes back to the blob when the cached entry has expired", async () => {
    const staleSnapshot: MarketSnapshot = { generatedAt: 1, forecasts: [] };
    // Far older than SETTINGS.cacheTtlMs (5 minutes).
    getBlob.mockResolvedValue(blobResult({ cachedAt: Date.now() - 60 * 60 * 1000, data: staleSnapshot }));

    const result = await getDurableMarketSnapshot();

    expect(getMarketSnapshot).toHaveBeenCalledTimes(1);
    expect(result).toEqual(await getMarketSnapshot.mock.results[0].value);
    expect(put).toHaveBeenCalledTimes(1);
    expect(put.mock.calls[0][0]).toBe(SNAPSHOT_PATHNAME);
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

  it("recomputes and writes back when the cached backtest report has expired", async () => {
    const staleReport = { confidenceCalibration: [] };
    getBlob.mockImplementation(async (pathname: string) => {
      // Far older than SETTINGS.backtestCacheTtlMs (1 hour).
      if (pathname === BACKTEST_PATHNAME) return blobResult({ cachedAt: Date.now() - 2 * 60 * 60 * 1000, data: staleReport });
      return null;
    });

    await calibratedSnapshot();

    expect(getBacktestReport).toHaveBeenCalledTimes(1);
    expect(put).toHaveBeenCalledWith(BACKTEST_PATHNAME, expect.any(String), expect.anything());
  });
});
