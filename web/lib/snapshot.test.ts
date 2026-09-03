import { describe, expect, it } from "vitest";
import { summarizeBacktest } from "./snapshot";
import type { BacktestReport } from "aero-allocator/backtest";

function makeReport(overrides: Partial<BacktestReport> = {}): BacktestReport {
  return {
    generatedAt: "2026-01-01T00:00:00.000Z",
    poolsAnalyzed: 30,
    epochsWindow: 26,
    samplePoints: 624,
    overall: {
      n: 624,
      mae: 3181.222,
      rmse: 7376.27,
      wape: 0.34512, // fraction — must become 34.5% below
      directionalAccuracyPct: 57.16, // already a percentage
      baselineMae: 3369.69,
      baselineWape: 0.3663,
      skillVsBaselineMaePct: 5.56,
      skillVsBaselineWapePct: 5.594, // already a percentage
    },
    byConfidence: [{ range: "0.00–0.30", n: 49, mae: 3252.86, wape: 0.4046 }],
    confidenceCalibration: [],
    worstMisses: [],
    methodology: "test methodology",
    ...overrides,
  };
}

describe("summarizeBacktest", () => {
  it("converts overall.wape from a fraction to a rounded percentage", () => {
    const summary = summarizeBacktest(makeReport());
    expect(summary.overall.wapePct).toBe(34.5);
  });

  it("passes already-percentage fields through with rounding only (no double ×100)", () => {
    const summary = summarizeBacktest(makeReport());
    expect(summary.overall.directionalAccuracyPct).toBe(57.2);
    expect(summary.overall.skillVsBaselineWapePct).toBe(5.6);
  });

  it("rounds mae to the nearest dollar", () => {
    const summary = summarizeBacktest(makeReport());
    expect(summary.overall.maeUsd).toBe(3181);
  });

  it("converts each confidence bucket's wape the same way as overall", () => {
    const summary = summarizeBacktest(makeReport());
    expect(summary.byConfidence).toEqual([{ range: "0.00–0.30", n: 49, wapePct: 40.5 }]);
  });

  it("passes through sample-size and methodology fields unchanged", () => {
    const summary = summarizeBacktest(makeReport());
    expect(summary.epochsWindow).toBe(26);
    expect(summary.poolsAnalyzed).toBe(30);
    expect(summary.samplePoints).toBe(624);
    expect(summary.methodology).toBe("test methodology");
  });
});
