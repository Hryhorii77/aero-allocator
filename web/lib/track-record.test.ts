import { describe, expect, it } from "vitest";
import type { DailyHistory } from "./daily-history";
import { addEntry, inLogWindow, MIN_DAYS_TO_SHOW, realizedUsdPerDay, recommend, summarize, TRACK_AMOUNT, type TrackEntry, type TrackLog } from "./track-record";
import type { GaugeRow } from "./gauges";

const G1 = "0x00000000000000000000000000000000000000a1";
const G2 = "0x00000000000000000000000000000000000000a2";
const gauge = (g: string, weight: number): GaugeRow => ({ gauge: g as `0x${string}`, pool: "0x1" as `0x${string}`, symbol: g.slice(-2), weight, sharePct: 1, capPerWeek: 1, activated: true, incentivesUsdPerWeek: 0, incentivesUsdPer1k: 0 });
const entry = (day: number, o: Partial<TrackEntry> = {}): TrackEntry => ({ t: day * 86_400 + 600, day, amount: 10_000, parts: [{ g: G1, s: "A", pct: 100 }], paceUsd: 10, lowUsd: 5, ...o });
// A daily record with fees in cents, weights in tokens and incentives in USD/week.
const daily = (points: Array<{ d: number; f: number[]; w: number[]; i: number[] }>): DailyHistory => ({ version: 1, chainId: 8453, gauges: [G1, G2], seen: [1, 1], points });

describe("recommend", () => {
  it("logs the split the model would give for the tracked amount, with its pace and low case", () => {
    const now = 1_000 * 86_400 + 300;
    const e = recommend([gauge(G1, 200_000), gauge(G2, 200_000)], { chainId: 8453, generatedAt: 0, windowHours: 40, fees: [{ gauge: G1 as `0x${string}`, feesUsdPerDay: 1000, windowHours: 40 }, { gauge: G2 as `0x${string}`, feesUsdPerDay: 900, windowHours: 40 }] }, now);
    expect(e?.amount).toBe(TRACK_AMOUNT);
    expect(e?.day).toBe(1000);
    expect(e!.parts.reduce((s, p) => s + p.pct, 0)).toBeCloseTo(100, 2);
    expect(e!.paceUsd).toBeGreaterThan(0);
    expect(e!.lowUsd).toBeLessThanOrEqual(e!.paceUsd);
  });
  it("is null when nothing can be ranked", () => {
    expect(recommend([gauge(G1, 200_000)], { chainId: 8453, generatedAt: 0, windowHours: 40, fees: [] }, 1)).toBeNull();
  });
});

describe("addEntry and inLogWindow", () => {
  it("keeps one entry per UTC day, newest last, and only logs in the first hours of a day", () => {
    const a = addEntry(null, entry(10));
    expect(addEntry(a, entry(10, { paceUsd: 99 }))).toBe(a);
    const b = addEntry(a, entry(11));
    expect(b.entries.map((e) => e.day)).toEqual([10, 11]);
    expect(inLogWindow(10 * 86_400 + 60)).toBe(true);
    expect(inLogWindow(10 * 86_400 + 4 * 3600)).toBe(false);
  });
  it("drops the oldest entries past the retention limit", () => {
    let log: TrackLog | null = null;
    for (let d = 0; d < 130; d++) log = addEntry(log, entry(d));
    expect(log!.entries).toHaveLength(120);
    expect(log!.entries[0].day).toBe(10);
  });
});

describe("realizedUsdPerDay", () => {
  it("averages the entry's own day and the next: (fees + incentives per day) times the share of the gauge's weight", () => {
    // Day 5: fees $400, weight 90,000, incentives $70/week ($10/day): (400 + 10) x 10,000/100,000 = 41
    // Day 6: fees $200, weight 190,000, no incentives: 200 x 10,000/200,000 = 10. Average 25.5.
    const d = daily([{ d: 5, f: [40_000, 0], w: [90_000, 0], i: [70, 0] }, { d: 6, f: [20_000, 0], w: [190_000, 0], i: [0, 0] }]);
    expect(realizedUsdPerDay(entry(5), d)).toBeCloseTo(25.5, 6);
  });
  it("sums the parts of a split by their own share of the amount", () => {
    const d = daily([{ d: 5, f: [10_000, 10_000], w: [40_000, 90_000], i: [0, 0] }, { d: 6, f: [10_000, 10_000], w: [40_000, 90_000], i: [0, 0] }]);
    const e = entry(5, { parts: [{ g: G1, s: "A", pct: 50 }, { g: G2, s: "B", pct: 50 }] });
    // 100 x 5,000/45,000 + 100 x 5,000/95,000
    expect(realizedUsdPerDay(e, d)).toBeCloseTo(100 * (5000 / 45000) + 100 * (5000 / 95000), 6);
  });
  it("is null until both days are recorded with weights, and for a gauge the record doesn't know", () => {
    expect(realizedUsdPerDay(entry(5), null)).toBeNull();
    expect(realizedUsdPerDay(entry(5), daily([{ d: 5, f: [1, 0], w: [1, 0], i: [0, 0] }]))).toBeNull();
    expect(realizedUsdPerDay(entry(5), daily([{ d: 5, f: [1, 0], w: [], i: [] }, { d: 6, f: [1, 0], w: [], i: [] }]))).toBeNull();
    expect(realizedUsdPerDay(entry(5, { parts: [{ g: "0xdead", s: "X", pct: 100 }] }), daily([{ d: 5, f: [1], w: [1], i: [0] }, { d: 6, f: [1], w: [1], i: [0] }]))).toBeNull();
  });
});

describe("summarize", () => {
  const days = (n: number, realizedFees: number) => {
    const points = Array.from({ length: n + 2 }, (_, k) => ({ d: k, f: [realizedFees, 0], w: [90_000, 0], i: [0, 0] }));
    const log = Array.from({ length: n }, (_, k) => entry(k)).reduce<TrackLog | null>((l, e) => addEntry(l, e), null);
    return { log, d: daily(points) };
  };
  it("shows no results before enough days are evaluated, but says how many it has", () => {
    const { log, d } = days(MIN_DAYS_TO_SHOW - 1, 100_000);
    const s = summarize(log, d);
    expect(s.logged).toBe(MIN_DAYS_TO_SHOW - 1);
    expect(s.evaluated).toBe(MIN_DAYS_TO_SHOW - 1);
    expect(s.results).toBeUndefined();
  });
  it("reports the median of realized over predicted and how often the low case was met, once there are enough days", () => {
    // fees $1,000/day, weight 90,000, share 0.1 -> realized $100/day against a predicted $10: ratio 10; low case $5 always met.
    const { log, d } = days(MIN_DAYS_TO_SHOW, 100_000);
    const s = summarize(log, d);
    expect(s.evaluated).toBe(MIN_DAYS_TO_SHOW);
    expect(s.results?.medianRealizedOfPredicted).toBe(10);
    expect(s.results?.atLeastLow).toBe(MIN_DAYS_TO_SHOW);
    expect(s.results?.avgRealizedUsd).toBeCloseTo(100, 4);
    expect(s.rows[0].day).toBe(MIN_DAYS_TO_SHOW - 1); // newest first
  });
  it("counts an entry as not evaluated while its days are not recorded, and survives no data at all", () => {
    const { log } = days(3, 100_000);
    expect(summarize(log, null).evaluated).toBe(0);
    expect(summarize(null, null)).toMatchObject({ logged: 0, evaluated: 0, rows: [] });
  });
});
