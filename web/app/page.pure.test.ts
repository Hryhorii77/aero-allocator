import { describe, expect, it } from "vitest";
import { usd, toCsv, formatCountdown, isConfidenceClustered, matchesPoolFilter, sparklinePoints, isThinLpOpportunity, wholePercentWeights, weightsClipboardText } from "./page";

describe("usd", () => {
  it("formats amounts under 1000 with up to 2 decimal places", () => {
    expect(usd(0)).toBe("$0");
    expect(usd(12.345)).toBe("$12.35");
    expect(usd(999.999)).toBe("$1,000");
  });

  it("pads cents rather than dropping a trailing zero, but leaves whole amounts whole", () => {
    // "$0.2" reads as a truncated number, especially at the size the Voter
    // ROI hero prints it — but "$42.00" is just noise.
    expect(usd(0.2)).toBe("$0.20");
    expect(usd(2.5)).toBe("$2.50");
    expect(usd(42)).toBe("$42");
  });

  it("rounds amounts at or above 1000 to the nearest whole dollar with thousands separators", () => {
    expect(usd(1000)).toBe("$1,000");
    expect(usd(1234567.89)).toBe("$1,234,568");
  });
});

describe("formatCountdown", () => {
  it("reports the epoch as just flipped for zero or negative ms", () => {
    expect(formatCountdown(0)).toBe("epoch just flipped");
    expect(formatCountdown(-1000)).toBe("epoch just flipped");
  });

  it("formats minutes-only durations under an hour", () => {
    expect(formatCountdown(5 * 60_000)).toBe("5m");
  });

  it("formats hours and minutes under a day", () => {
    expect(formatCountdown(3 * 3_600_000 + 20 * 60_000)).toBe("3h 20m");
  });

  it("formats days and hours at a day or more", () => {
    expect(formatCountdown(2 * 86_400_000 + 5 * 3_600_000 + 59 * 60_000)).toBe("2d 5h");
  });
});

describe("isConfidenceClustered", () => {
  it("is false with fewer than 3 values, regardless of spread", () => {
    expect(isConfidenceClustered([0.77, 0.78])).toBe(false);
  });

  it("is true when every value sits within a few points of the others", () => {
    expect(isConfidenceClustered([0.76, 0.77, 0.78, 0.775])).toBe(true);
  });

  it("is false once the spread crosses the threshold", () => {
    expect(isConfidenceClustered([0.4, 0.6, 0.9])).toBe(false);
  });

  it("catches an 8pp spread as clustered — too little to move a ~32px bar by a perceptible amount", () => {
    // The exact live case an external review flagged as still rendering
    // bars ("looks like decoration") under the old, purely-statistical 3pp
    // threshold.
    expect(isConfidenceClustered([0.71, 0.75, 0.78])).toBe(true);
  });
});

describe("isThinLpOpportunity", () => {
  const healthy = { stakedTvlUsd: 100_000, currentEpochAprPct: 20, predictedNextEpochAprPct: 25 };

  it("is false for a pool with real TVL and a sane APR", () => {
    expect(isThinLpOpportunity(healthy)).toBe(false);
  });

  it("is true when staked TVL is under $50k, regardless of APR", () => {
    expect(isThinLpOpportunity({ ...healthy, stakedTvlUsd: 1_900 })).toBe(true);
  });

  it("is true when either APR figure exceeds 1,000%, even with healthy TVL", () => {
    // The exact case flagged externally: "81,007% current / 39,326%
    // predicted on $1.9k TVL looks like a bug even if the math is right" —
    // catch it on the APR side too, not just the TVL side, since a real
    // whale TVL pool with a broken/manipulated APR should still be flagged.
    expect(isThinLpOpportunity({ ...healthy, currentEpochAprPct: 81_007 })).toBe(true);
    expect(isThinLpOpportunity({ ...healthy, predictedNextEpochAprPct: 39_326 })).toBe(true);
  });

  it("is false right at the boundary (not thin)", () => {
    expect(isThinLpOpportunity({ stakedTvlUsd: 50_000, currentEpochAprPct: 1000, predictedNextEpochAprPct: 1000 })).toBe(false);
  });
});

describe("matchesPoolFilter", () => {
  const basePool = { symbol: "TEST/USDC", lastEpochFeesUsd: 100, edgePct: 0, confidence: 0.5 };

  it("matches everything under 'all'", () => {
    expect(matchesPoolFilter(basePool, "all", "AERO")).toBe(true);
  });

  it("matches a stablecoin ticker anywhere in the symbol under 'stables'", () => {
    expect(matchesPoolFilter({ ...basePool, symbol: "WETH/USDC" }, "stables", "AERO")).toBe(true);
    expect(matchesPoolFilter({ ...basePool, symbol: "WETH/WBTC" }, "stables", "AERO")).toBe(false);
  });

  it("matches the configured protocol token under 'aero', case-insensitively", () => {
    expect(matchesPoolFilter({ ...basePool, symbol: "aero/usdc" }, "aero", "AERO")).toBe(true);
    expect(matchesPoolFilter({ ...basePool, symbol: "WETH/USDC" }, "aero", "AERO")).toBe(false);
  });

  it("matches BTC-wrapped symbols under 'btc'", () => {
    expect(matchesPoolFilter({ ...basePool, symbol: "CBBTC/USDC" }, "btc", "AERO")).toBe(true);
    expect(matchesPoolFilter({ ...basePool, symbol: "WETH/USDC" }, "btc", "AERO")).toBe(false);
  });

  it("matches pools with no prior-epoch fees under 'new'", () => {
    expect(matchesPoolFilter({ ...basePool, lastEpochFeesUsd: 0 }, "new", "AERO")).toBe(true);
    expect(matchesPoolFilter({ ...basePool, lastEpochFeesUsd: 1 }, "new", "AERO")).toBe(false);
  });

  it("matches only a positive edge under 'positiveEdge'", () => {
    expect(matchesPoolFilter({ ...basePool, edgePct: 5 }, "positiveEdge", "AERO")).toBe(true);
    expect(matchesPoolFilter({ ...basePool, edgePct: 0 }, "positiveEdge", "AERO")).toBe(false);
    expect(matchesPoolFilter({ ...basePool, edgePct: -5 }, "positiveEdge", "AERO")).toBe(false);
  });

  it("matches confidence at or above 0.6 under 'highConf'", () => {
    expect(matchesPoolFilter({ ...basePool, confidence: 0.6 }, "highConf", "AERO")).toBe(true);
    expect(matchesPoolFilter({ ...basePool, confidence: 0.59 }, "highConf", "AERO")).toBe(false);
  });
});

describe("sparklinePoints", () => {
  it("returns an empty string for no values", () => {
    expect(sparklinePoints([], 100, 20)).toBe("");
  });

  it("draws a flat mid-height line for a single value", () => {
    expect(sparklinePoints([42], 100, 20)).toBe("0,10 100,10");
  });

  it("spans the full width and height between the min and max value", () => {
    // Lowest value pins to the bottom (y = height), highest to the top (y = 0).
    const points = sparklinePoints([0, 10], 100, 20);
    expect(points).toBe("0.0,20.0 100.0,0.0");
  });

  it("places a flat series (equal min and max) in a straight line, not a division-by-zero glitch", () => {
    const points = sparklinePoints([5, 5, 5], 100, 20);
    expect(points).toBe("0.0,20.0 50.0,20.0 100.0,20.0");
  });
});

describe("toCsv", () => {
  it("returns an empty string for no rows", () => {
    expect(toCsv([])).toBe("");
  });

  it("uses the first row's keys as the header, in order", () => {
    const csv = toCsv([{ b: 1, a: 2 }]);
    expect(csv.split("\n")[0]).toBe("b,a");
  });

  it("quotes and escapes values containing commas, quotes, or newlines", () => {
    // Assert on the whole CSV, not a naive split("\n") — the field's own
    // embedded newline is inside quotes and shouldn't be treated as a row
    // boundary by a real CSV parser (or by this test).
    const csv = toCsv([{ symbol: 'CL50-WETH/USDC, "wrapped"', note: "line1\nline2" }]);
    expect(csv).toBe('symbol,note\n"CL50-WETH/USDC, ""wrapped""","line1\nline2"');
  });

  it("leaves plain values unquoted", () => {
    const csv = toCsv([{ symbol: "CL50-WETH/USDC", weightPct: 33.5 }]);
    expect(csv.split("\n")[1]).toBe("CL50-WETH/USDC,33.5");
  });

  it("renders one row per input row, same column order for every row", () => {
    const csv = toCsv([
      { pool: "0x1", weightPct: 10 },
      { pool: "0x2", weightPct: 20 },
    ]);
    expect(csv).toBe("pool,weightPct\n0x1,10\n0x2,20");
  });
});

describe("wholePercentWeights", () => {
  const sum = (rows: Array<{ wholePct: number }>) => rows.reduce((s, r) => s + r.wholePct, 0);

  it("sums to exactly 100 where plain rounding would land on 99 or 101", () => {
    // Math.round gives 33+33+33 = 99 here, and 17+17+17+17+17+17 = 102 below.
    const thirds = wholePercentWeights([{ weightPct: 33.33 }, { weightPct: 33.33 }, { weightPct: 33.34 }]);
    expect(sum(thirds)).toBe(100);
    const sixths = wholePercentWeights(Array.from({ length: 6 }, () => ({ weightPct: 100 / 6 })));
    expect(sum(sixths)).toBe(100);
    expect(sixths.every((r) => Number.isInteger(r.wholePct))).toBe(true);
  });

  it("gives the leftover points to the rows that lost the most to the floor", () => {
    const rows = wholePercentWeights([{ weightPct: 40.9 }, { weightPct: 30.2 }, { weightPct: 28.9 }]);
    expect(rows.map((r) => r.wholePct)).toEqual([41, 30, 29]);
  });

  it("renormalizes weights that don't already sum to 100", () => {
    expect(wholePercentWeights([{ weightPct: 1 }, { weightPct: 3 }]).map((r) => r.wholePct)).toEqual([25, 75]);
  });

  it("drops a row that rounds to 0% rather than listing a pool nobody should type in", () => {
    const rows = wholePercentWeights([{ weightPct: 99.8 }, { weightPct: 0.2 }]);
    expect(rows).toHaveLength(1);
    expect(sum(rows)).toBe(100);
  });

  it("returns nothing for an empty or all-zero split", () => {
    expect(wholePercentWeights([])).toEqual([]);
    expect(wholePercentWeights([{ weightPct: 0 }])).toEqual([]);
  });
});

describe("weightsClipboardText", () => {
  it("is a header line, one line per pool, then a compact pcts line", () => {
    const text = weightsClipboardText(
      [
        { symbol: "vAMM-WETH/USDC", weightPct: 35.4 },
        { symbol: "CL100-cbBTC/WETH", weightPct: 34.6 },
        { symbol: "vAMM-AERO/USDC", weightPct: 30 },
      ],
      10000,
      85.52,
    );
    expect(text.split("\n")).toEqual([
      "Aerodrome Allocator voter_roi · 10,000 veAERO · expected $85.52 next epoch",
      "vAMM-WETH/USDC  35%",
      "CL100-cbBTC/WETH  35%",
      "vAMM-AERO/USDC  30%",
      "pcts: 35/35/30",
    ]);
  });
});
