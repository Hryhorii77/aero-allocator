import { describe, expect, it } from "vitest";
import { aprPct, MIN_RANK_WEIGHT, paceLabel, rankByUsdPerDay, steadyLabel, steadySortScore } from "./gauge-yield";
import type { GaugeRow } from "./gauges";

const row = (gauge: string, weight: number, inc = 0, activated = true): GaugeRow => ({
  gauge: gauge as GaugeRow["gauge"],
  pool: "0x1" as GaugeRow["pool"],
  symbol: gauge,
  weight,
  sharePct: 0,
  capPerWeek: 0,
  activated,
  incentivesUsdPerWeek: inc,
  incentivesUsdPer1k: 0,
});
const fee = (gauge: string, usd: number) => ({ gauge: gauge as GaugeRow["gauge"], feesUsdPerDay: usd, windowHours: 5 });

describe("rankByUsdPerDay", () => {
  it("scales (fees + incentives) by your share of the weight after you join", () => {
    const [r] = rankByUsdPerDay([row("0xa", 1_000_000, 700)], [fee("0xa", 900)], 1_000_000);
    expect(r.sharePct).toBe(50);
    expect(r.usdPerDay).toBe((900 + 100) * 0.5);
  });
  it("dilution flips the order as the amount grows", () => {
    const gs = [row("0xsmall", 200_000), row("0xbig", 5_000_000)];
    const fs = [fee("0xsmall", 100), fee("0xbig", 600)];
    expect(rankByUsdPerDay(gs, fs, 10_000)[0].gauge).toBe("0xsmall"); // 10k of 210k beats 10k of 5.01M per dollar
    expect(rankByUsdPerDay(gs, fs, 5_000_000)[0].gauge).toBe("0xbig");
  });
  it("skips dust, inactive and unestimated gauges", () => {
    const gs = [row("0xdust", MIN_RANK_WEIGHT - 1), row("0xoff", 1e6, 0, false), row("0xnofee", 1e6), row("0xok", 1e6)];
    const out = rankByUsdPerDay(gs, [fee("0xdust", 1e6), fee("0xoff", 1e6), fee("0xok", 10)], 1000);
    expect(out.map((r) => r.gauge)).toEqual(["0xok"]);
  });
  it("matches gauges case-insensitively and returns nothing for a non-positive amount", () => {
    expect(rankByUsdPerDay([row("0xAbC", 1e6)], [fee("0xabc", 5)], 1000)).toHaveLength(1);
    expect(rankByUsdPerDay([row("0xa", 1e6)], [fee("0xa", 5)], 0)).toEqual([]);
  });
});

describe("aprPct", () => {
  it("is the yearly return on the amount at the AERO price", () => {
    // $10/day on 10,000 AERO at $0.75 = $3,650 a year on $7,500.
    expect(aprPct(10, 10_000, 0.75)).toBeCloseTo(48.667, 3);
    expect(aprPct(0, 10_000, 0.75)).toBe(0);
  });

  it("is null without a price or an amount rather than a made-up number", () => {
    expect(aprPct(10, 10_000, null)).toBeNull();
    expect(aprPct(10, 10_000, undefined)).toBeNull();
    expect(aprPct(10, 10_000, 0)).toBeNull();
    expect(aprPct(10, 0, 0.75)).toBeNull();
  });
});

describe("steadyLabel", () => {
  const y = (fees: number, inc: number, steady?: { buckets: number; paying: number }) => ({ feesUsdPerDay: fees, incentivesUsdPerDay: inc, steady });
  it("calls a gauge paid mostly by incentives steady by construction, whatever its fee record says", () => {
    expect(steadyLabel(y(20, 61, { buckets: 4, paying: 1 }))).toEqual({ kind: "incentives" });
    expect(steadySortScore(y(20, 61, { buckets: 4, paying: 1 }))).toBe(1);
  });
  it("otherwise reports the fee record's paying half-days, or nothing", () => {
    expect(steadyLabel(y(100, 10, { buckets: 4, paying: 3 }))).toEqual({ kind: "fees", buckets: 4, paying: 3 });
    expect(steadySortScore(y(100, 10, { buckets: 4, paying: 3 }))).toBe(0.75);
    expect(steadyLabel(y(100, 10))).toBeNull();
    expect(steadySortScore(y(100, 10))).toBe(-1);
  });
});

describe("paceLabel", () => {
  it("is spiky for a burst, otherwise how much history the pace rests on", () => {
    expect(paceLabel({ windowHours: 48, spike: { typicalUsdPerDay: 100 } })).toBe("spiky");
    expect(paceLabel({ windowHours: 48 })).toBe("solid");
    expect(paceLabel({ windowHours: 10 })).toBe("fair");
    expect(paceLabel({ windowHours: 2 })).toBe("thin");
  });
  it("passes a gauge's spike through the ranking", () => {
    const rows = rankByUsdPerDay(
      [row("0xa", 1_000_000)],
      [{ gauge: "0xa" as `0x${string}`, feesUsdPerDay: 1000, windowHours: 48, spike: { typicalUsdPerDay: 100 } }],
      1000,
    );
    expect(rows[0].spike).toEqual({ typicalUsdPerDay: 100 });
  });
});
