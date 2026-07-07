import { SETTINGS, currentEpochStart, epochProgress } from "./config.js";
import { fetchHistories, scanPools, splitCurrentEpoch } from "./data.js";
import type {
  AllocationObjective,
  AllocationRecommendation,
  EpochStats,
  PoolForecast,
  PoolInfo,
} from "./types.js";

/**
 * Forecast next-epoch fees from a series of completed-epoch fees (newest first).
 * EWMA captures the level; a linear trend term captures momentum. This mirrors
 * the Predictive Allocation thesis: reward where demand is going, not where it was.
 */
export function forecastFees(completedNewestFirst: number[]): {
  predicted: number;
  trend: number;
  confidence: number;
} {
  const series = completedNewestFirst.filter((x) => Number.isFinite(x));
  if (series.length === 0) return { predicted: 0, trend: 0, confidence: 0 };
  if (series.length === 1) return { predicted: series[0], trend: 0, confidence: 0.2 };

  // EWMA over newest-first series.
  const a = SETTINGS.ewmaAlpha;
  let ewma = 0;
  let weight = 0;
  for (let i = 0; i < series.length; i++) {
    const w = a * (1 - a) ** i;
    ewma += w * series[i];
    weight += w;
  }
  ewma /= weight;

  // OLS slope over chronological order (oldest -> newest), USD per epoch.
  const chron = [...series].reverse();
  const n = chron.length;
  const xMean = (n - 1) / 2;
  const yMean = chron.reduce((s, y) => s + y, 0) / n;
  let num = 0;
  let den = 0;
  for (let x = 0; x < n; x++) {
    num += (x - xMean) * (chron[x] - yMean);
    den += (x - xMean) ** 2;
  }
  const slope = den > 0 ? num / den : 0;

  // Blend: level + half the momentum, never below zero. Damping the trend
  // avoids over-extrapolating one hot week.
  const predicted = Math.max(0, ewma + 0.5 * slope);

  // Confidence: more history and lower relative variance = higher confidence.
  const variance = chron.reduce((s, y) => s + (y - yMean) ** 2, 0) / n;
  const cv = yMean > 0 ? Math.sqrt(variance) / yMean : 1;
  const depthScore = Math.min(1, (n - 1) / 5);
  const stabilityScore = 1 / (1 + cv);
  const confidence = Math.round(depthScore * stabilityScore * 100) / 100;

  return { predicted, trend: slope, confidence };
}

export interface MarketSnapshot {
  generatedAt: number;
  forecasts: PoolForecast[];
}

let snapshotCache: { at: number; promise: Promise<MarketSnapshot> } | null = null;

/** Build (and cache) the full market snapshot: pools, histories, forecasts. */
export function getMarketSnapshot(force = false): Promise<MarketSnapshot> {
  const now = Date.now();
  if (!force && snapshotCache && now - snapshotCache.at < SETTINGS.cacheTtlMs) {
    return snapshotCache.promise;
  }
  const promise = buildSnapshot();
  snapshotCache = { at: now, promise };
  promise.catch(() => {
    snapshotCache = null;
  });
  return promise;
}

async function buildSnapshot(): Promise<MarketSnapshot> {
  const pools = await scanPools({ maxPools: SETTINGS.maxCandidates });
  const histories = await fetchHistories(pools.map((p) => p.lp));

  const partials = pools.map((pool) => {
    const history = histories.get(pool.lp.toLowerCase()) ?? [];
    const { current, completed } = splitCurrentEpoch(history);
    const feeSeries = completed.map((e) => e.feesUsd);

    // The in-progress epoch, extrapolated to full length, is the freshest
    // demand signal — prepend it when at least 20% of the epoch has elapsed.
    const progress = epochProgress();
    if (current && progress > 0.2) {
      feeSeries.unshift(current.feesUsd / progress);
    }

    const { predicted, trend, confidence } = forecastFees(feeSeries);
    return { pool, history, current, completed, predicted, trend, confidence };
  });

  const totalPredicted = partials.reduce((s, p) => s + p.predicted, 0);
  const totalVotes = partials.reduce((s, p) => s + (p.current?.votes ?? p.completed[0]?.votes ?? 0), 0);

  const forecasts: PoolForecast[] = partials.map((p) => {
    const votes = p.current?.votes ?? p.completed[0]?.votes ?? 0;
    const voteShare = totalVotes > 0 ? votes / totalVotes : 0;
    const predictedDemandShare = totalPredicted > 0 ? p.predicted / totalPredicted : 0;
    const last = p.completed[0];
    const lastRewards = (last?.feesUsd ?? 0) + (last?.bribesUsd ?? 0);
    const lastVotes = last?.votes ?? 0;
    return {
      pool: p.pool,
      history: p.history,
      predictedFeesUsd: round2(p.predicted),
      lastEpochFeesUsd: round2(last?.feesUsd ?? 0),
      feeTrendUsdPerEpoch: round2(p.trend),
      currentBribesUsd: round2(p.current?.bribesUsd ?? 0),
      voteShare,
      predictedDemandShare,
      predictiveEdge: predictedDemandShare - voteShare,
      rewardPer1kVotesUsd: lastVotes > 0 ? round2((lastRewards / lastVotes) * 1000) : 0,
      confidence: p.confidence,
    };
  });

  forecasts.sort((a, b) => b.predictedFeesUsd - a.predictedFeesUsd);
  return { generatedAt: Date.now(), forecasts };
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

/**
 * Turn forecasts into a concrete allocation.
 *
 * protocol_efficiency: weights proportional to predicted fee demand — what an
 * ideal Predictive Allocation outcome looks like. Useful for benchmarking and
 * for directing incentives as a protocol/treasury.
 *
 * voter_roi: maximize expected reward per vote. Greedy toward the
 * highest (fees+bribes)/votes pools, confidence-weighted, with a per-pool cap
 * so votes don't crowd into one gauge and dilute their own return.
 */
export function recommendAllocation(
  snapshot: MarketSnapshot,
  objective: AllocationObjective,
  maxPools = 10,
): AllocationRecommendation {
  const eligible = snapshot.forecasts.filter((f) => f.pool.gaugeAlive && f.confidence > 0);

  let scored: Array<{ f: PoolForecast; weight: number; rationale: string }>;

  if (objective === "protocol_efficiency") {
    scored = eligible
      .filter((f) => f.predictedDemandShare > 0)
      .sort((a, b) => b.predictedDemandShare - a.predictedDemandShare)
      .slice(0, maxPools)
      .map((f) => ({
        f,
        weight: f.predictedDemandShare,
        rationale: rationaleFor(f, "demand"),
      }));
  } else {
    const CAP = 0.25;
    scored = eligible
      .filter((f) => f.rewardPer1kVotesUsd > 0)
      .map((f) => ({
        f,
        // Expected ROI, shrunk toward the field average by forecast confidence,
        // and nudged by the predictive edge (under-voted pools dilute slower).
        weight:
          f.rewardPer1kVotesUsd * (0.5 + 0.5 * f.confidence) * (1 + Math.max(0, f.predictiveEdge) * 2),
        rationale: rationaleFor(f, "roi"),
      }))
      .sort((a, b) => b.weight - a.weight)
      .slice(0, maxPools);
    const total = scored.reduce((s, x) => s + x.weight, 0);
    scored = scored.map((x) => ({ ...x, weight: Math.min(x.weight / total, CAP) }));
  }

  const totalW = scored.reduce((s, x) => s + x.weight, 0);
  const allocations = scored.map(({ f, weight, rationale }) => ({
    pool: f.pool.lp,
    symbol: f.pool.symbol,
    weightPct: round2((weight / totalW) * 100),
    currentVoteSharePct: round2(f.voteShare * 100),
    predictedDemandSharePct: round2(f.predictedDemandShare * 100),
    predictiveEdgePct: round2(f.predictiveEdge * 100),
    rewardPer1kVotesUsd: f.rewardPer1kVotesUsd,
    confidence: f.confidence,
    rationale,
  }));

  const topEdge = [...eligible].sort((a, b) => b.predictiveEdge - a.predictiveEdge)[0];
  const summary =
    objective === "protocol_efficiency"
      ? `Allocate proportional to predicted next-epoch fee demand across ${allocations.length} pools. ` +
        `Largest mispricing: ${topEdge?.pool.symbol ?? "n/a"} is under-incentivized by ` +
        `${round2((topEdge?.predictiveEdge ?? 0) * 100)}pp of vote share vs predicted demand.`
      : `Maximize reward per vote across ${allocations.length} pools (25% per-pool cap). ` +
        `Best raw ROI: ${allocations[0]?.symbol ?? "n/a"} at ~$${allocations[0]?.rewardPer1kVotesUsd ?? 0}/1k votes last epoch.`;

  return {
    objective,
    generatedAt: new Date(snapshot.generatedAt).toISOString(),
    epochStart: currentEpochStart(),
    epochProgressPct: round2(epochProgress() * 100),
    allocations,
    summary,
  };
}

function rationaleFor(f: PoolForecast, kind: "demand" | "roi"): string {
  const trend =
    f.feeTrendUsdPerEpoch > 0
      ? `fees growing ~$${Math.abs(f.feeTrendUsdPerEpoch).toLocaleString()}/epoch`
      : f.feeTrendUsdPerEpoch < 0
        ? `fees declining ~$${Math.abs(f.feeTrendUsdPerEpoch).toLocaleString()}/epoch`
        : "fees flat";
  if (kind === "demand") {
    return `Predicted $${f.predictedFeesUsd.toLocaleString()} next-epoch fees (${trend}); ` +
      `vote share ${round2(f.voteShare * 100)}% vs demand share ${round2(f.predictedDemandShare * 100)}%.`;
  }
  return `~$${f.rewardPer1kVotesUsd}/1k votes last epoch; ${trend}; ` +
    `edge ${round2(f.predictiveEdge * 100)}pp; confidence ${f.confidence}.`;
}

/** Compact epoch history view for tool output. */
export function summarizeHistory(history: EpochStats[]): Array<Record<string, number | string>> {
  return history.map((e) => ({
    epoch: new Date(e.ts * 1000).toISOString().slice(0, 10),
    votes: Math.round(e.votes),
    emissions: Math.round(e.emissions),
    feesUsd: Math.round(e.feesUsd),
    bribesUsd: Math.round(e.bribesUsd),
  }));
}
