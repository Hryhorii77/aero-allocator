import { describe, expect, it } from "vitest";
import { aprPct, incentiveEndText, incentivesOverWait, MIN_RANK_WEIGHT, paceLabel, rankByUsdPerDay, steadyLabel, steadySortScore } from "./gauge-yield";
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

describe("incentives that end inside the wait", () => {
  const H = 3600;
  const WAIT = 47 * H;
  it("averages each program over the wait, counting it only until it ends", () => {
    // $100/day for the whole wait, $100/day for the first 23.5 h (half), nothing after
    const r = incentivesOverWait([{ end: 1_000_000 + 2 * WAIT, usdPerDay: 100 }, { end: 1_000_000 + WAIT / 2, usdPerDay: 100 }], 1_000_000, WAIT);
    expect(r?.avgUsdPerDay).toBeCloseTo(150, 6);
    expect(r?.first).toBe(1_000_000 + WAIT / 2);
    expect(r?.last).toBe(1_000_000 + 2 * WAIT);
  });
  it("counts nothing for a program that has already ended and is null with no programs", () => {
    expect(incentivesOverWait([{ end: 500, usdPerDay: 100 }], 1000, WAIT)?.avgUsdPerDay).toBe(0);
    expect(incentivesOverWait([], 1000, WAIT)).toBeNull();
  });
  it("puts the average on the ranked row but leaves today's pace figure alone", () => {
    const now = 1_000_000;
    const g = { ...row("0xa", 1_000_000, 700), incentivePrograms: [{ end: now + WAIT / 2, usdPerDay: 100 }] };
    const [r] = rankByUsdPerDay([g], [fee("0xa", 900)], 1_000_000, undefined, { nowSec: now, waitSec: WAIT });
    expect(r.incentivesUsdPerDay).toBe(100);
    expect(r.incentivesLowUsdPerDay).toBeCloseTo(50, 6);
    expect(r.usdPerDay).toBe((900 + 100) * 0.5);
    expect(r.incentivesEnd).toEqual({ first: now + WAIT / 2, last: now + WAIT / 2 });
  });
  it("leaves the fields out when the end times are unknown (older payloads)", () => {
    const [r] = rankByUsdPerDay([row("0xa", 1_000_000, 700)], [fee("0xa", 900)], 1000);
    expect(r.incentivesLowUsdPerDay).toBeUndefined();
    expect(r.incentivesEnd).toBeUndefined();
  });
  it("says the Steady column is not steady when incentive income stops inside the wait", () => {
    const y = { feesUsdPerDay: 20, incentivesUsdPerDay: 80, incentivesLowUsdPerDay: 40 };
    expect(steadyLabel(y)).toEqual({ kind: "incentives", endsSoon: true });
    expect(steadySortScore(y)).toBe(0.5);
    expect(steadyLabel({ ...y, incentivesLowUsdPerDay: 80 })).toEqual({ kind: "incentives" });
  });
  it("words the row line by how much of the income ends, and shows nothing when it all runs on", () => {
    const now = 1_000_000;
    const base = { incentivesUsdPerDay: 100, incentivesLowUsdPerDay: 40 };
    expect(incentiveEndText({ ...base, incentivesEnd: { first: now + 31 * H, last: now + 31 * H } }, now, WAIT)).toBe("incentives end in 31 h");
    expect(incentiveEndText({ ...base, incentivesEnd: { first: now + 6 * H, last: now + 200 * H } }, now, WAIT)).toBe("some incentives end in 6 h");
    expect(incentiveEndText({ ...base, incentivesEnd: { first: now + 600, last: now + 600 } }, now, WAIT)).toBe("incentives end in under 1 h");
    expect(incentiveEndText({ incentivesUsdPerDay: 100, incentivesLowUsdPerDay: 100, incentivesEnd: { first: now + 300 * H, last: now + 300 * H } }, now, WAIT)).toBeNull();
    expect(incentiveEndText({ incentivesUsdPerDay: 100 }, now, WAIT)).toBeNull();
  });
});
