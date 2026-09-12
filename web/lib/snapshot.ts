import { after } from "next/server";
import { put, get as getBlob } from "@vercel/blob";
import {
  applyConfidenceCalibration,
  getMarketSnapshot,
  recommendAllocation,
  recommendLpDeposits,
  detectVoteSwings,
  type MarketSnapshot,
} from "aero-allocator/scoring";
import { getBacktestReport, type BacktestReport } from "aero-allocator/backtest";
import { getRewardTokenPriceUsd } from "aero-allocator/data";
import { currentEpochStart, epochProgress, PROTOCOL, SETTINGS } from "aero-allocator/config";
import { adapter as predictiveAllocationAdapter } from "aero-allocator/predictive-allocation";

// getMarketSnapshot's and getBacktestReport's own caches (aero-allocator/
// scoring, aero-allocator/backtest) are both per-instance — a fresh
// serverless instance (a real cold start, or just a different
// region/instance Vercel routed to) has an empty cache and pays full price
// (RPC scan + DefiLlama fetch for the snapshot; its own pool scan + 26
// epochs of history for the backtest) regardless of how recently some
// *other* instance built the exact same thing. This adds a cross-instance
// layer on top of both via Vercel Blob, so only the first request after
// each's TTL lapses anywhere pays that cost — everyone else reads the
// shared blob instead. Deliberately kept out of the engine package: that
// package also runs as the MCP server outside Vercel, where Blob
// credentials don't exist, so this wrapper lives web-side only.
async function readDurableCache<T>(pathname: string): Promise<{ cachedAt: number; data: T } | null> {
  try {
    const result = await getBlob(pathname, { access: "private" });
    if (!result) {
      console.log(JSON.stringify({ level: "info", tag: "durable-cache", pathname, reason: "not-found" }));
      return null;
    }
    if (result.statusCode !== 200 || !result.stream) {
      console.log(
        JSON.stringify({ level: "info", tag: "durable-cache", pathname, reason: "bad-response", statusCode: result.statusCode }),
      );
      return null;
    }
    const text = await new Response(result.stream).text();
    const parsed = JSON.parse(text) as { cachedAt?: unknown; data?: unknown };
    // A blob written under an older shape of this cache (a field rename, for
    // instance — exactly what happened once already during development)
    // would otherwise parse fine but hand back `data: undefined`, which
    // callers trust completely and dereference straight into a crash. Treat
    // anything that doesn't look like this cache's shape as a miss instead.
    if (typeof parsed.cachedAt !== "number" || parsed.data === undefined) {
      console.log(JSON.stringify({ level: "info", tag: "durable-cache", pathname, reason: "malformed-shape" }));
      return null;
    }
    return parsed as { cachedAt: number; data: T };
  } catch (e) {
    // No blob store configured (e.g. local dev without BLOB_READ_WRITE_TOKEN),
    // nothing written yet, or a transient Blob error — fall back to a live
    // rebuild either way; this cache is a latency nicety, not a correctness
    // requirement. Logged (not just swallowed) so a *persistent* failure is
    // visible instead of only ever showing up as an unexplained "miss".
    const error = e instanceof Error ? e : new Error(String(e));
    console.error(JSON.stringify({ level: "error", tag: "durable-cache", pathname, reason: "threw", message: error.message }));
    return null;
  }
}

async function writeDurableCache<T>(pathname: string, data: T): Promise<void> {
  try {
    await put(pathname, JSON.stringify({ cachedAt: Date.now(), data }), {
      access: "private",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "application/json",
    });
  } catch {
    // Best-effort — a failed write just means the next request (on any
    // instance) rebuilds too, same as today without this cache.
  }
}

// Structured (searchable in Vercel's Logs tab) record of which path each
// durable cache took — the only way to actually verify from the outside
// that a cold instance served a request from Blob rather than quietly
// paying for a full rebuild anyway (Grok round 5: "I can't swear every
// cold region is instant until Blob is actually wired ... and the next
// deploy misses cache on purpose").
function logDurableCache(
  cache: string,
  outcome: "hit" | "stale-hit" | "miss" | "rebuilt" | "background-refreshed" | "background-refresh-failed",
  extra: Record<string, unknown> = {},
) {
  console.log(JSON.stringify({ level: "info", tag: "durable-cache", cache, outcome, ...extra }));
}

/**
 * Stale-while-revalidate: a bare TTL means whoever is unlucky enough to be
 * the first visitor after it lapses always pays full price, no matter how
 * short or long it's set — Grok round 6 caught exactly this (a visit ~38
 * minutes after the last one cold-started, since the snapshot TTL is only
 * 5 minutes). Once a blob has been written at least once, this makes sure
 * *no visitor ever waits on a rebuild again*: an expired entry is still
 * served immediately, with a background refresh (via Next's after(),
 * which extends the serverless invocation past the response using
 * Vercel's waitUntil) kicked off for the *next* request to benefit from.
 * `inFlight` coalesces concurrent triggers on the same warm instance —
 * several requests can all see the same stale blob before the first
 * refresh finishes.
 */
function refreshInBackground<T>(cache: string, pathname: string, inFlight: { promise: Promise<void> | null }, rebuild: () => Promise<T>) {
  if (inFlight.promise) return;
  inFlight.promise = (async () => {
    try {
      const fresh = await rebuild();
      await writeDurableCache(pathname, fresh);
      logDurableCache(cache, "background-refreshed");
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e));
      logDurableCache(cache, "background-refresh-failed", { message: error.message });
    } finally {
      inFlight.promise = null;
    }
  })();
  after(() => inFlight.promise ?? Promise.resolve());
}

const SNAPSHOT_BLOB_PATHNAME = "market-snapshot-cache.json";
const snapshotRefreshInFlight: { promise: Promise<void> | null } = { promise: null };

/**
 * getMarketSnapshot, plus the cross-instance durable cache described above.
 * `refresh` bypasses both this and the engine's own in-memory cache, same
 * contract as getMarketSnapshot itself.
 */
export async function getDurableMarketSnapshot(refresh = false): Promise<MarketSnapshot> {
  const startedAt = Date.now();
  if (!refresh) {
    const cached = await readDurableCache<MarketSnapshot>(SNAPSHOT_BLOB_PATHNAME);
    if (cached) {
      const ageMs = Date.now() - cached.cachedAt;
      if (ageMs < SETTINGS.cacheTtlMs) {
        logDurableCache("snapshot", "hit", { ageMs, durationMs: Date.now() - startedAt });
        return cached.data;
      }
      logDurableCache("snapshot", "stale-hit", { ageMs, durationMs: Date.now() - startedAt });
      refreshInBackground("snapshot", SNAPSHOT_BLOB_PATHNAME, snapshotRefreshInFlight, () => getMarketSnapshot(false));
      return cached.data;
    }
    logDurableCache("snapshot", "miss");
  }
  const snapshot = await getMarketSnapshot(refresh);
  await writeDurableCache(SNAPSHOT_BLOB_PATHNAME, snapshot);
  logDurableCache("snapshot", "rebuilt", { refresh, durationMs: Date.now() - startedAt });
  return snapshot;
}

const BACKTEST_BLOB_PATHNAME = "backtest-report-cache.json";
const backtestRefreshInFlight: { promise: Promise<void> | null } = { promise: null };

/**
 * getBacktestReport (default params only — the same call calibratedSnapshot
 * and buildFullForecast make), plus the cross-instance durable cache and
 * the same stale-while-revalidate behavior as the snapshot above. Its own
 * walk-forward replay is a second, independent RPC-bound cost from the
 * live snapshot's — this is exactly what a fresh instance was still paying
 * during an earlier live check (48s) even after the snapshot side hit its
 * own blob cache.
 */
async function getDurableBacktestReport(): Promise<BacktestReport> {
  const startedAt = Date.now();
  const cached = await readDurableCache<BacktestReport>(BACKTEST_BLOB_PATHNAME);
  if (cached) {
    const ageMs = Date.now() - cached.cachedAt;
    if (ageMs < SETTINGS.backtestCacheTtlMs) {
      logDurableCache("backtest", "hit", { ageMs, durationMs: Date.now() - startedAt });
      return cached.data;
    }
    logDurableCache("backtest", "stale-hit", { ageMs, durationMs: Date.now() - startedAt });
    refreshInBackground("backtest", BACKTEST_BLOB_PATHNAME, backtestRefreshInFlight, () => getBacktestReport());
    return cached.data;
  }
  logDurableCache("backtest", "miss");
  const report = await getBacktestReport();
  await writeDurableCache(BACKTEST_BLOB_PATHNAME, report);
  logDurableCache("backtest", "rebuilt", { durationMs: Date.now() - startedAt });
  return report;
}

/**
 * Compact track-record summary for the dashboard's "forecast accuracy"
 * panel — trims getBacktestReport's full output (worst-misses list,
 * per-point data) down to what's worth showing a visitor deciding whether
 * to trust these forecasts. Mixed units in the source report (backtest.ts):
 * `wape` is a raw fraction (0..1, needs ×100), while anything already
 * named "...Pct" (directionalAccuracyPct, skillVsBaselineWapePct) is
 * already a percentage — same convention the CLI backtest script relies on.
 */
export function summarizeBacktest(report: BacktestReport) {
  return {
    epochsWindow: report.epochsWindow,
    poolsAnalyzed: report.poolsAnalyzed,
    samplePoints: report.samplePoints,
    overall: {
      maeUsd: Math.round(report.overall.mae),
      wapePct: Math.round(report.overall.wape * 1000) / 10,
      directionalAccuracyPct: Math.round(report.overall.directionalAccuracyPct * 10) / 10,
      skillVsBaselineWapePct: Math.round(report.overall.skillVsBaselineWapePct * 10) / 10,
    },
    byConfidence: report.byConfidence.map((b) => ({
      range: b.range,
      n: b.n,
      wapePct: Math.round(b.wape * 1000) / 10,
    })),
    methodology: report.methodology,
  };
}
export type BacktestSummary = ReturnType<typeof summarizeBacktest>;

/**
 * Snapshot with confidence recalibrated against backtested accuracy, when
 * available — mirrors the MCP server's calibratedSnapshot (src/index.ts) so
 * the dashboard's confidence bars match what the MCP tools report. Any
 * backtest fetch failure falls back to the raw heuristic confidence.
 */
export async function calibratedSnapshot(refresh = false): Promise<MarketSnapshot> {
  const [snap, calibration] = await Promise.all([
    getDurableMarketSnapshot(refresh),
    getDurableBacktestReport()
      .then((r) => r.confidenceCalibration)
      .catch(() => undefined),
  ]);
  return calibration ? applyConfidenceCalibration(snap, calibration) : snap;
}

/**
 * The full forecast payload: pools + all three allocation objectives + LP
 * yield + vote swings. Shared by the free dashboard (api/dashboard) and the
 * paid x402 endpoint (api/v1/forecast) — same computation, same one
 * snapshot build, just gated differently.
 */
export async function buildFullForecast(votingPower: number, refresh = false) {
  // getDurableMarketSnapshot(refresh) fetched once and reused for both the
  // calibrated and raw views — calling calibratedSnapshot(refresh) here too
  // (as this used to) would independently re-invoke it with force=true,
  // which bypasses the cache-check unconditionally and starts a second full
  // RPC scan + DefiLlama price fetch in parallel with this one, doubling
  // load on every `refresh=1` request for no benefit (same data).
  const [rawSnap, backtestReport, rewardTokenPriceUsd] = await Promise.all([
    getDurableMarketSnapshot(refresh),
    // Full report, not just .confidenceCalibration — also feeds the
    // dashboard's track-record panel below. getDurableBacktestReport has its
    // own ~1h cache (see SETTINGS.backtestCacheTtlMs), so this costs nothing
    // extra beyond what calibratedSnapshot already paid for confidence
    // recalibration.
    getDurableBacktestReport().catch(() => null),
    getRewardTokenPriceUsd(),
  ]);
  const snap = backtestReport ? applyConfidenceCalibration(rawSnap, backtestReport.confidenceCalibration) : rawSnap;

  return {
    // Dromos Labs' Predictive Allocation (real-time incentive allocation,
    // dated September 2026) is meant to replace weekly gauge voting — but
    // contracts/ABI aren't published yet, so `live` is always false today.
    // `adapter.isLive()` flips to true purely from env vars once they are
    // (see src/adapters/predictive-allocation.ts), with no code change here
    // — the dashboard's status chip picks that up automatically.
    paStatus: {
      applicable: PROTOCOL === "aerodrome",
      live: PROTOCOL === "aerodrome" && predictiveAllocationAdapter.isLive(),
    },
    trackRecord: backtestReport ? summarizeBacktest(backtestReport) : null,
    generatedAt: snap.generatedAt,
    epochStart: currentEpochStart(),
    epochProgressPct: Math.round(epochProgress() * 1000) / 10,
    pools: snap.forecasts.map((f) => ({
      lp: f.pool.lp,
      symbol: f.pool.symbol,
      poolType: f.pool.poolType,
      tvlUsd: Math.round(f.pool.tvlUsd),
      predictedFeesUsd: f.predictedFeesUsd,
      lastEpochFeesUsd: f.lastEpochFeesUsd,
      feeTrendUsdPerEpoch: f.feeTrendUsdPerEpoch,
      currentBribesUsd: f.currentBribesUsd,
      voteSharePct: Math.round(f.voteShare * 10000) / 100,
      demandSharePct: Math.round(f.predictedDemandShare * 10000) / 100,
      edgePct: Math.round(f.predictiveEdge * 10000) / 100,
      rewardPer1kVotesUsd: f.rewardPer1kVotesUsd,
      confidence: f.confidence,
    })),
    voterAlloc: recommendAllocation(snap, "voter_roi", 8, votingPower),
    protoAlloc: recommendAllocation(snap, "protocol_efficiency", 8),
    edgeAlloc: recommendAllocation(snap, "edge_hunter", 8),
    lpDeposits: recommendLpDeposits(rawSnap, rewardTokenPriceUsd, { maxPools: 15 }),
    voteSwings: detectVoteSwings(rawSnap, { maxPools: 8 }),
  };
}
