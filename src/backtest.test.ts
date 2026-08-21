import { describe, expect, it } from "vitest";
import { aggregateBacktest, confidenceBuckets, deriveConfidenceCalibration, walkForwardBacktest, type BacktestPoint } from "./backtest.js";
import { forecastFees } from "./scoring.js";
import type { EpochStats } from "./types.js";

function epoch(ts: number, feesUsd: number): EpochStats {
  return { ts, votes: 1000, emissions: 0, feesUsd, bribesUsd: 0 };
}

// Newest-first, like fetchEpochHistory's output.
const SIX_EPOCHS: EpochStats[] = [
  epoch(600, 600),
  epoch(500, 500),
  epoch(400, 400),
  epoch(300, 300),
  epoch(200, 200),
  epoch(100, 100),
];

describe("walkForwardBacktest", () => {
  it("produces one point per epoch with enough trailing history", () => {
    const points = walkForwardBacktest(SIX_EPOCHS, 8, 2);
    // 6 epochs, minTrailingEpochs=2 -> epochs at index 0..3 qualify (4 points).
    expect(points).toHaveLength(4);
    expect(points.map((p) => p.ts)).toEqual([600, 500, 400, 300]);
  });

  it("matches forecastFees run on the same trailing slice it uses internally", () => {
    const points = walkForwardBacktest(SIX_EPOCHS, 8, 2);
    const expected = forecastFees([500, 400, 300, 200, 100]);
    expect(points[0].predicted).toBe(expected.predicted);
    expect(points[0].confidence).toBe(expected.confidence);
    expect(points[0].actual).toBe(600);
  });

  it("sets baseline to the immediately older epoch's actual (naive persistence)", () => {
    const points = walkForwardBacktest(SIX_EPOCHS, 8, 2);
    for (const [i, p] of points.entries()) {
      expect(p.baseline).toBe(SIX_EPOCHS[i + 1].feesUsd);
    }
  });

  it("caps the trailing window at windowSize even when more history is available", () => {
    const points = walkForwardBacktest(SIX_EPOCHS, 3, 2);
    // At i=0, only [500,400,300] should feed the forecast — not [500,400,300,200,100].
    const capped = forecastFees([500, 400, 300]);
    const uncapped = forecastFees([500, 400, 300, 200, 100]);
    expect(points[0].predicted).toBe(capped.predicted);
    expect(points[0].predicted).not.toBe(uncapped.predicted);
  });

  it("respects minTrailingEpochs", () => {
    const three = SIX_EPOCHS.slice(0, 3); // [600, 500, 400]
    expect(walkForwardBacktest(three, 8, 2)).toHaveLength(1);
    expect(walkForwardBacktest(three, 8, 3)).toHaveLength(0);
  });

  it("returns an empty array for empty history", () => {
    expect(walkForwardBacktest([], 8, 2)).toEqual([]);
  });
});

function point(overrides: Partial<BacktestPoint> = {}): BacktestPoint {
  return { ts: 0, actual: 0, predicted: 0, confidence: 1, baseline: 0, ...overrides };
}

describe("aggregateBacktest", () => {
  it("computes mae/rmse/wape and skill vs. a naive baseline", () => {
    const points = [
      point({ actual: 100, predicted: 110, baseline: 100 }),
      point({ actual: 200, predicted: 180, baseline: 200 }),
      point({ actual: 50, predicted: 60, baseline: 40 }),
    ];
    const m = aggregateBacktest(points);
    expect(m.n).toBe(3);
    expect(m.mae).toBeCloseTo(13.33, 2);
    expect(m.rmse).toBeCloseTo(14.14, 2);
    expect(m.wape).toBeCloseTo(0.1143, 4);
    expect(m.baselineMae).toBeCloseTo(3.33, 2);
    expect(m.baselineWape).toBeCloseTo(0.0286, 4);
    // This "model" is 4x worse than persistence on both metrics.
    expect(m.skillVsBaselineMaePct).toBeCloseTo(-300, 1);
    expect(m.skillVsBaselineWapePct).toBeCloseTo(-300, 1);
    expect(m.directionalAccuracyPct).toBe(100);
  });

  it("scores a perfect forecast as zero error and 100% skill", () => {
    const points = [
      point({ actual: 100, predicted: 100, baseline: 90 }),
      point({ actual: 50, predicted: 50, baseline: 40 }),
    ];
    const m = aggregateBacktest(points);
    expect(m.mae).toBe(0);
    expect(m.rmse).toBe(0);
    expect(m.wape).toBe(0);
    expect(m.skillVsBaselineMaePct).toBe(100);
    expect(m.skillVsBaselineWapePct).toBe(100);
  });

  it("counts directional accuracy only over points where actual differs from baseline", () => {
    const points = [
      point({ actual: 110, predicted: 120, baseline: 100 }), // correct direction (up)
      point({ actual: 90, predicted: 120, baseline: 100 }), // wrong direction
      point({ actual: 100, predicted: 999, baseline: 100 }), // flat baseline, excluded
    ];
    expect(aggregateBacktest(points).directionalAccuracyPct).toBe(50);
  });

  it("returns zeros, not NaN, for an empty point set", () => {
    expect(aggregateBacktest([])).toEqual({
      n: 0,
      mae: 0,
      rmse: 0,
      wape: 0,
      directionalAccuracyPct: 0,
      baselineMae: 0,
      baselineWape: 0,
      skillVsBaselineMaePct: 0,
      skillVsBaselineWapePct: 0,
    });
  });

  it("guards wape division by zero when all actuals are zero", () => {
    const m = aggregateBacktest([point({ actual: 0, predicted: 5, baseline: 0 })]);
    expect(m.wape).toBe(0);
    expect(m.baselineWape).toBe(0);
    expect(Number.isFinite(m.mae)).toBe(true);
  });
});

describe("confidenceBuckets", () => {
  it("splits points into confidence ranges and reports per-bucket error", () => {
    const points = [
      point({ confidence: 0.1, actual: 100, predicted: 110, baseline: 100 }),
      point({ confidence: 0.5, actual: 100, predicted: 100, baseline: 100 }),
      point({ confidence: 0.9, actual: 100, predicted: 100, baseline: 100 }),
    ];
    const buckets = confidenceBuckets(points);
    expect(buckets).toHaveLength(3);
    expect(buckets.map((b) => b.n)).toEqual([1, 1, 1]);
    expect(buckets[0].range).toBe("0.00–0.30");
    expect(buckets[2].mae).toBe(0);
  });

  it("puts a boundary value in the upper bucket, and confidence=1 in the last bucket", () => {
    const points = [point({ confidence: 0.3 }), point({ confidence: 1 })];
    const buckets = confidenceBuckets(points, [0.3, 0.6]);
    expect(buckets[0].n).toBe(0);
    expect(buckets[1].n).toBe(1); // the 0.3 point
    expect(buckets[2].n).toBe(1); // the 1.0 point
  });

  it("returns empty buckets (not errors) when there are no points", () => {
    const buckets = confidenceBuckets([]);
    expect(buckets.every((b) => b.n === 0)).toBe(true);
  });
});

describe("deriveConfidenceCalibration", () => {
  it("computes calibratedConfidence = 1/(1+wape) per bucket", () => {
    // Low-confidence bucket: badly wrong (wape=1 -> calibrated 0.5).
    const low = Array.from({ length: 10 }, () => point({ confidence: 0.1, actual: 100, predicted: 200, baseline: 100 }));
    // High-confidence bucket: dead on (wape=0 -> calibrated 1).
    const high = Array.from({ length: 10 }, () => point({ confidence: 0.9, actual: 100, predicted: 100, baseline: 100 }));

    const calibration = deriveConfidenceCalibration([...low, ...high]);
    const lowBucket = calibration.find((b) => b.min === 0 && b.max === 0.3);
    const highBucket = calibration.find((b) => b.max === 1);

    expect(lowBucket?.calibratedConfidence).toBeCloseTo(0.5, 4);
    expect(highBucket?.calibratedConfidence).toBe(1);
  });

  it("drops buckets with fewer samples than the minimum", () => {
    const points = [point({ confidence: 0.9, actual: 100, predicted: 100, baseline: 100 })]; // only 1 sample
    expect(deriveConfidenceCalibration(points, [0.3, 0.6], 8)).toEqual([]);
    expect(deriveConfidenceCalibration(points, [0.3, 0.6], 1)).toHaveLength(1);
  });

  it("returns no buckets for an empty point set", () => {
    expect(deriveConfidenceCalibration([])).toEqual([]);
  });
});
