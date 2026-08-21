import { SETTINGS } from "./config.js";
import { fetchHistories, scanPools, splitCurrentEpoch } from "./data.js";
import { forecastFees, type ConfidenceCalibrationBucket } from "./scoring.js";
import type { EpochStats } from "./types.js";

/**
 * One walk-forward forecast/actual pair: at the point epoch `ts` was about to
 * start, what did the model predict vs. what actually happened, and what
 * would a naive "predict = last epoch" baseline have said?
 */
export interface BacktestPoint {
  ts: number;
  actual: number;
  predicted: number;
  confidence: number;
  baseline: number;
}

export interface BacktestMetrics {
  n: number;
  mae: number;
  rmse: number;
  wape: number;
  directionalAccuracyPct: number;
  baselineMae: number;
  baselineWape: number;
  skillVsBaselineMaePct: number;
  skillVsBaselineWapePct: number;
}

/**
 * Replay a pool's completed-epoch history: for each epoch, forecast it using
 * only the epochs that were actually available beforehand (capped at
 * `windowSize`, the same trailing window production feeds `forecastFees` —
 * without the cap this would unfairly hand the model more history than it
 * ever sees live). `completedNewestFirst` must exclude any in-progress epoch.
 */
export function walkForwardBacktest(
  completedNewestFirst: EpochStats[],
  windowSize: number = SETTINGS.historyEpochs,
  minTrailingEpochs = 2,
): BacktestPoint[] {
  const points: BacktestPoint[] = [];
  for (let i = 0; i + 1 + minTrailingEpochs <= completedNewestFirst.length; i++) {
    const trailing = completedNewestFirst.slice(i + 1, i + 1 + windowSize);
    const { predicted, confidence } = forecastFees(trailing.map((e) => e.feesUsd));
    points.push({
      ts: completedNewestFirst[i].ts,
      actual: completedNewestFirst[i].feesUsd,
      predicted,
      confidence,
      baseline: trailing[0].feesUsd,
    });
  }
  return points;
}

function mean(xs: number[]): number {
  return xs.length > 0 ? xs.reduce((s, x) => s + x, 0) / xs.length : 0;
}

/** Aggregate error metrics across walk-forward points, benchmarked against the naive persistence baseline. */
export function aggregateBacktest(points: BacktestPoint[]): BacktestMetrics {
  const n = points.length;
  if (n === 0) {
    return {
      n: 0,
      mae: 0,
      rmse: 0,
      wape: 0,
      directionalAccuracyPct: 0,
      baselineMae: 0,
      baselineWape: 0,
      skillVsBaselineMaePct: 0,
      skillVsBaselineWapePct: 0,
    };
  }

  const errs = points.map((p) => p.predicted - p.actual);
  const baseErrs = points.map((p) => p.baseline - p.actual);
  const actualSum = points.reduce((s, p) => s + p.actual, 0);

  const mae = mean(errs.map(Math.abs));
  const rmse = Math.sqrt(mean(errs.map((e) => e * e)));
  const wape = actualSum > 0 ? errs.reduce((s, e) => s + Math.abs(e), 0) / actualSum : 0;

  const baselineMae = mean(baseErrs.map(Math.abs));
  const baselineWape = actualSum > 0 ? baseErrs.reduce((s, e) => s + Math.abs(e), 0) / actualSum : 0;

  const directional = points.filter((p) => p.actual !== p.baseline);
  const directionalAccuracyPct =
    directional.length > 0
      ? (100 * directional.filter((p) => Math.sign(p.predicted - p.baseline) === Math.sign(p.actual - p.baseline)).length) /
        directional.length
      : 0;

  const skillVsBaselineMaePct = baselineMae > 0 ? 100 * (1 - mae / baselineMae) : 0;
  const skillVsBaselineWapePct = baselineWape > 0 ? 100 * (1 - wape / baselineWape) : 0;

  return {
    n,
    mae: round2(mae),
    rmse: round2(rmse),
    wape: round4(wape),
    directionalAccuracyPct: round2(directionalAccuracyPct),
    baselineMae: round2(baselineMae),
    baselineWape: round4(baselineWape),
    skillVsBaselineMaePct: round2(skillVsBaselineMaePct),
    skillVsBaselineWapePct: round2(skillVsBaselineWapePct),
  };
}

function bucketByConfidence(
  points: BacktestPoint[],
  edges: number[],
): Array<{ min: number; max: number; points: BacktestPoint[] }> {
  const sortedEdges = [...edges].sort((a, b) => a - b);
  const bounds = [0, ...sortedEdges, 1];
  const buckets: BacktestPoint[][] = bounds.slice(0, -1).map(() => []);

  for (const p of points) {
    let idx = bounds.length - 2;
    for (let i = 0; i < bounds.length - 1; i++) {
      const isLast = i === bounds.length - 2;
      if (p.confidence >= bounds[i] && (p.confidence < bounds[i + 1] || (isLast && p.confidence <= bounds[i + 1]))) {
        idx = i;
        break;
      }
    }
    buckets[idx].push(p);
  }

  return buckets.map((bucketPoints, i) => ({ min: bounds[i], max: bounds[i + 1], points: bucketPoints }));
}

/** Bucket points by forecast confidence and report error per bucket — checks whether confidence is calibrated. */
export function confidenceBuckets(
  points: BacktestPoint[],
  edges: number[] = [0.3, 0.6],
): Array<{ range: string; n: number; mae: number; wape: number }> {
  return bucketByConfidence(points, edges).map(({ min, max, points: bucketPoints }) => {
    const m = aggregateBacktest(bucketPoints);
    return { range: `${min.toFixed(2)}–${max.toFixed(2)}`, n: m.n, mae: m.mae, wape: m.wape };
  });
}

const MIN_CALIBRATION_SAMPLES = 8;

/**
 * Convert per-confidence-bucket backtested accuracy into a calibration curve
 * for applyConfidenceCalibration (scoring.ts): calibratedConfidence =
 * 1/(1+wape), so a bucket that was historically noisy gets marked down even
 * if the heuristic thought it looked confident. Buckets with too few samples
 * to trust are dropped — applyConfidenceCalibration leaves forecasts in a
 * dropped range at their heuristic score rather than using a noisy estimate.
 */
export function deriveConfidenceCalibration(
  points: BacktestPoint[],
  edges: number[] = [0.3, 0.6],
  minSamples = MIN_CALIBRATION_SAMPLES,
): ConfidenceCalibrationBucket[] {
  return bucketByConfidence(points, edges)
    .map(({ min, max, points: bucketPoints }) => {
      const m = aggregateBacktest(bucketPoints);
      return { min, max, n: m.n, wape: m.wape, calibratedConfidence: round2(1 / (1 + m.wape)) };
    })
    .filter((b) => b.n >= minSamples);
}

export interface BacktestReport {
  generatedAt: string;
  poolsAnalyzed: number;
  epochsWindow: number;
  samplePoints: number;
  overall: BacktestMetrics;
  byConfidence: ReturnType<typeof confidenceBuckets>;
  /** Calibration curve for applyConfidenceCalibration (scoring.ts) — how live confidence gets recalibrated. */
  confidenceCalibration: ConfidenceCalibrationBucket[];
  worstMisses: Array<{
    pool: string;
    symbol: string;
    epoch: string;
    predictedFeesUsd: number;
    actualFeesUsd: number;
    absErrorUsd: number;
  }>;
  methodology: string;
}

const METHODOLOGY =
  "Walk-forward replay of completed epochs: each historical epoch is forecast using only the epochs " +
  "that would have been available beforehand (capped at the same trailing window predict_demand uses), " +
  "then compared to the realized fees and to a naive 'predict = last epoch' persistence baseline. " +
  "Does not replay the mid-epoch pace-extrapolation blend used for the live in-progress epoch.";

let reportCache: { at: number; promise: Promise<BacktestReport> } | null = null;

/**
 * Build (and, for default params, cache) a backtest report. Only the
 * default-params call is cached — explicit maxPools/epochs overrides always
 * compute fresh, since they're presumed to be deliberate one-off requests.
 */
export function getBacktestReport(opts?: {
  force?: boolean;
  maxPools?: number;
  epochs?: number;
}): Promise<BacktestReport> {
  const useDefaults = opts?.maxPools === undefined && opts?.epochs === undefined;
  const now = Date.now();
  if (useDefaults && !opts?.force && reportCache && now - reportCache.at < SETTINGS.backtestCacheTtlMs) {
    return reportCache.promise;
  }
  const promise = buildBacktestReport(opts?.maxPools ?? SETTINGS.backtestMaxPools, opts?.epochs ?? SETTINGS.backtestEpochs);
  if (useDefaults) {
    reportCache = { at: now, promise };
    promise.catch(() => {
      reportCache = null;
    });
  }
  return promise;
}

async function buildBacktestReport(maxPools: number, epochs: number): Promise<BacktestReport> {
  const pools = await scanPools({ maxPools });
  const histories = await fetchHistories(
    pools.map((p) => p.lp),
    epochs,
  );

  const tagged: Array<BacktestPoint & { pool: string; symbol: string }> = [];
  for (const pool of pools) {
    const history = histories.get(pool.lp.toLowerCase()) ?? [];
    const { completed } = splitCurrentEpoch(history);
    for (const point of walkForwardBacktest(completed)) {
      tagged.push({ ...point, pool: pool.lp, symbol: pool.symbol });
    }
  }

  const worstMisses = [...tagged]
    .sort((a, b) => Math.abs(b.predicted - b.actual) - Math.abs(a.predicted - a.actual))
    .slice(0, 5)
    .map((p) => ({
      pool: p.pool,
      symbol: p.symbol,
      epoch: new Date(p.ts * 1000).toISOString().slice(0, 10),
      predictedFeesUsd: round2(p.predicted),
      actualFeesUsd: round2(p.actual),
      absErrorUsd: round2(Math.abs(p.predicted - p.actual)),
    }));

  return {
    generatedAt: new Date().toISOString(),
    poolsAnalyzed: pools.length,
    epochsWindow: epochs,
    samplePoints: tagged.length,
    overall: aggregateBacktest(tagged),
    byConfidence: confidenceBuckets(tagged),
    confidenceCalibration: deriveConfidenceCalibration(tagged),
    worstMisses,
    methodology: METHODOLOGY,
  };
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

function round4(x: number): number {
  return Math.round(x * 10000) / 10000;
}
