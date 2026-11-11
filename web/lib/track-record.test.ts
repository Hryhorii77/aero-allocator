import { describe, expect, it } from "vitest";
import type { DailyHistory } from "./daily-history";
import { DAY_SEC, rollupDays } from "./daily-history";
import { addEntry, autopilotRealizedUsdPerDay, inLogWindow, INPUTS_KEPT, MIN_DAYS_TO_SHOW, RANK_RULE, realizedUsdPerDay, recommend, summarize, TRACK_AMOUNT, type AutopilotSnap, type TrackEntry, type TrackLog } from "./track-record";
import type { GaugeRow } from "./gauges";

const G1 = "0x00000000000000000000000000000000000000a1";
const G2 = "0x00000000000000000000000000000000000000a2";
const gauge = (g: string, weight: number): GaugeRow => ({ gauge: g as `0x${string}`, pool: "0x1" as `0x${string}`, symbol: g.slice(-2), weight, sharePct: 1, capPerWeek: 1, activated: true, incentivesUsdPerWeek: 0, incentivesUsdPer1k: 0 });
const entry = (day: number, o: Partial<TrackEntry> = {}): TrackEntry => ({ t: day * 86_400 + 600, day, amount: 10_000, parts: [{ g: G1, s: "A", pct: 100 }], paceUsd: 10, lowUsd: 5, rule: RANK_RULE, ...o });
// A daily record with fees in USD, weights in tokens and incentives in USD/week, as rollupDays writes it.
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
  it("marks the entry with the ranking rule now running, and ranks a spiking gauge at its usual level", () => {
    const now = 1_000 * 86_400 + 300;
    const fees = { chainId: 8453, generatedAt: 0, windowHours: 40, fees: [
      { gauge: G1 as `0x${string}`, feesUsdPerDay: 5000, windowHours: 40, spike: { typicalUsdPerDay: 100 } },
      { gauge: G2 as `0x${string}`, feesUsdPerDay: 900, windowHours: 40 },
    ] };
    const e = recommend([gauge(G1, 200_000), gauge(G2, 200_000)], fees, now)!;
    expect(e.rule).toBe(RANK_RULE);
    expect(e.parts[0].g).toBe(G2.toLowerCase());
    expect(e.parts.find((p) => p.g === G1.toLowerCase())?.pct ?? 0).toBeLessThan(50);
  });
  it("keeps the ranking's inputs for the split's gauges and the runners-up, so a miss can be explained later", () => {
    const now = 1_000 * 86_400 + 300;
    const gs = Array.from({ length: 30 }, (_, k) => `0x${(0xb0 + k).toString(16).padStart(40, "0")}`);
    const fees = { chainId: 8453, generatedAt: 0, windowHours: 40, fees: gs.map((g, k) => ({
      gauge: g as `0x${string}`, feesUsdPerDay: 1000 - k * 20, windowHours: 40.04,
      ...(k === 0 ? { spike: { typicalUsdPerDay: 980.456 }, typicalUsdPerDay: 980.456, steady: { buckets: 8, paying: 5 } } : {}),
      ...(k === 1 ? { typicalUsdPerDay: 543.21 } : {}),
    })) };
    const e = recommend(gs.map((g) => gauge(g, 200_000.4)), fees, now)!;
    expect(e.in).toHaveLength(INPUTS_KEPT);
    for (const p of e.parts) expect(e.in!.some((x) => x.g === p.g)).toBe(true);
    const first = e.in!.find((x) => x.g === gs[0])!;
    expect(first).toEqual({ g: gs[0], f: 1000, u: 980.46, i: 0, w: 200_000, h: 40, sp: 5, sb: 8 });
    // The usual level is kept on an ordinary day too, not only on a burst.
    expect(e.in!.find((x) => x.g === gs[1])?.u).toBe(543.21);
    expect(e.in!.find((x) => x.g === gs[2])?.u).toBeUndefined();
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
    const d = daily([{ d: 5, f: [400, 0], w: [90_000, 0], i: [70, 0] }, { d: 6, f: [200, 0], w: [190_000, 0], i: [0, 0] }]);
    expect(realizedUsdPerDay(entry(5), d)).toBeCloseTo(25.5, 6);
  });
  it("sums the parts of a split by their own share of the amount", () => {
    const d = daily([{ d: 5, f: [100, 100], w: [40_000, 90_000], i: [0, 0] }, { d: 6, f: [100, 100], w: [40_000, 90_000], i: [0, 0] }]);
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
    const { log, d } = days(MIN_DAYS_TO_SHOW - 1, 1_000);
    const s = summarize(log, d);
    expect(s.logged).toBe(MIN_DAYS_TO_SHOW - 1);
    expect(s.evaluated).toBe(MIN_DAYS_TO_SHOW - 1);
    expect(s.results).toBeUndefined();
  });
  it("reports the median of realized over predicted and how often the low case was met, once there are enough days", () => {
    // fees $1,000/day, weight 90,000, share 0.1 -> realized $100/day against a predicted $10: ratio 10; low case $5 always met.
    const { log, d } = days(MIN_DAYS_TO_SHOW, 1_000);
    const s = summarize(log, d);
    expect(s.evaluated).toBe(MIN_DAYS_TO_SHOW);
    expect(s.results?.medianRealizedOfPredicted).toBe(10);
    expect(s.results?.atLeastLow).toBe(MIN_DAYS_TO_SHOW);
    expect(s.results?.avgRealizedUsd).toBeCloseTo(100, 4);
    expect(s.rows[0].day).toBe(MIN_DAYS_TO_SHOW - 1); // newest first
  });
  it("counts only entries of the current rule toward the results, and says how many earlier-rule entries it lists", () => {
    const { log, d } = days(MIN_DAYS_TO_SHOW, 1_000);
    const older = { ...log!, entries: log!.entries.map((e, k) => (k < 3 ? { ...e, rule: undefined } : { ...e, rule: RANK_RULE })) };
    const s = summarize(older, d);
    expect(s.rule).toBe(RANK_RULE);
    expect(s.earlierRule).toBe(3);
    expect(s.logged).toBe(MIN_DAYS_TO_SHOW - 3);
    expect(s.evaluated).toBe(MIN_DAYS_TO_SHOW - 3);
    expect(s.results).toBeUndefined(); // 14 days logged, but 3 were under the old rule
    expect(s.rows.filter((r) => r.rule === 1)).toHaveLength(3);
  });
  it("counts an entry as not evaluated while its days are not recorded, and survives no data at all", () => {
    const { log } = days(3, 1_000);
    expect(summarize(log, null).evaluated).toBe(0);
    expect(summarize(null, null)).toMatchObject({ logged: 0, evaluated: 0, rows: [] });
  });
});

describe("realizedUsdPerDay reads the record the real writer makes", () => {
  it("counts a $3,793.91 day as dollars: the units of rollupDays and realizedUsdPerDay agree", () => {
    // The WETH/MORPHO entry of 2026-11-01 (day 20758) with its real figures: fees $3,793.91 and $1,903.85, weight 19,066,276 and 18,878,891.
    const D = 20_758;
    const at = (d: number, h: number) => d * DAY_SEC + h * 3600;
    const releases = [{ gauge: G1, releases: [{ t: at(D - 1, 1), usd: 1 }, { t: at(D, 12), usd: 3793.91 }, { t: at(D + 1, 12), usd: 1903.85 }] }];
    const weights = { version: 1 as const, chainId: 8453, gauges: [G1], points: [{ t: at(D, 23), w: [19_066_276], i: [0] }, { t: at(D + 1, 23), w: [18_878_891], i: [0] }] };
    const record = rollupDays(null, 8453, releases, at(D - 1, 0), weights, at(D + 2, 1))!;
    const got = realizedUsdPerDay(entry(D), record)!;
    const want = (3793.91 * 10_000) / (19_066_276 + 10_000) / 2 + (1903.85 * 10_000) / (18_878_891 + 10_000) / 2;
    expect(got).toBeCloseTo(want, 6);
    expect(got).toBeGreaterThan(1.4); // about $1.50 a day, not the $0.015 the cents bug showed
    expect(got).toBeLessThan(1.6);
  });
});


describe("Autopilot next to the split", () => {
  const OP = 10;
  const G3 = "0x00000000000000000000000000000000000000b3";
  // Base: G1 pays $1,000/day at weight 90,000. OP: G3 pays $700/week of incentives plus $200/day of fees at weight 40,000.
  const base = daily([0, 1, 2, 3].map((d) => ({ d, f: [1_000, 0], w: [90_000, 0], i: [0, 0] })));
  const op: DailyHistory = { version: 1, chainId: OP, gauges: [G3], seen: [1], points: [0, 1, 2, 3].map((d) => ({ d, f: [200], w: [40_000], i: [700] })) };
  // A pool of 1,000,000 power: 400,000 on Base's G1, 400,000 on OP's G3, 200,000 idle.
  const snap: AutopilotSnap = { id: 20366, power: 1_000_000, parts: [{ c: 8453, g: G1, a: 400_000 }, { c: OP, g: G3, a: 400_000 }] };
  const dailyOf = (c: number) => (c === 8453 ? base : c === OP ? op : null);

  it("spreads the deposit like the pool, lets the idle share earn nothing, and prices each gauge from its own chain's record", () => {
    // 10,000 -> 4,000 on G1: 1000 x 4000/94000; 4,000 on G3: (200 + 100) x 4000/44000; 2,000 idle.
    const want = (1000 * 4000) / 94_000 + (300 * 4000) / 44_000;
    expect(autopilotRealizedUsdPerDay(snap, 0, 10_000, dailyOf)).toBeCloseTo(want, 6);
  });
  it("is null until both days are recorded on every chain the pool used", () => {
    expect(autopilotRealizedUsdPerDay(snap, 3, 10_000, dailyOf)).toBeNull(); // day 4 not recorded
    expect(autopilotRealizedUsdPerDay(snap, 0, 10_000, (c) => (c === 8453 ? base : null))).toBeNull(); // OP's record missing
    expect(autopilotRealizedUsdPerDay({ ...snap, parts: [{ c: OP, g: "0xdead", a: 1 }] }, 0, 10_000, dailyOf)).toBeNull(); // gauge not in the record
  });
  it("pays nothing for a pool that sat wholly idle, once the days are recorded", () => {
    expect(autopilotRealizedUsdPerDay({ ...snap, parts: [] }, 0, 10_000, dailyOf)).toBe(0);
    expect(autopilotRealizedUsdPerDay({ ...snap, parts: [] }, 3, 10_000, dailyOf)).toBeNull();
  });
  it("adds each pool's figure to its row, largest pool first, and compares only after enough days with both checked", () => {
    const small: AutopilotSnap = { id: 20365, power: 10_000, parts: [] };
    const make = (n: number) => {
      const points = Array.from({ length: n + 2 }, (_, d) => ({ d, f: [1_000, 0], w: [90_000, 0], i: [0, 0] }));
      const opPoints = points.map(({ d }) => ({ d, f: [200], w: [40_000], i: [700] }));
      const log = Array.from({ length: n }, (_, k) => entry(k, { ap: [small, snap] })).reduce<TrackLog | null>((l, e) => addEntry(l, e), null);
      return summarize(log, daily(points), undefined, new Map([[OP, { ...op, points: opPoints }]]));
    };
    const early = make(MIN_DAYS_TO_SHOW - 1);
    expect(early.rows[0].autopilot?.map((a) => a.id)).toEqual([20366, 20365]);
    expect(early.rows[0].autopilot?.[1].realizedUsd).toBe(0);
    expect(early.vsAutopilot).toBeUndefined();
    const s = make(MIN_DAYS_TO_SHOW);
    // The split: 10,000 on G1 at weight 90,000 -> $100/day. Autopilot's largest pool: about $69.83/day.
    expect(s.vsAutopilot).toMatchObject({ days: MIN_DAYS_TO_SHOW, splitAhead: MIN_DAYS_TO_SHOW });
    expect(s.vsAutopilot!.avgSplitUsd).toBeCloseTo(100, 4);
    expect(s.vsAutopilot!.avgAutopilotUsd).toBeCloseTo((1000 * 4000) / 94_000 + (300 * 4000) / 44_000, 3);
  });
  it("leaves rows logged before Autopilot was tracked without the field", () => {
    const s = summarize(addEntry(null, entry(0)), base);
    expect(s.rows[0]).not.toHaveProperty("autopilot");
    expect(s.vsAutopilot).toBeUndefined();
  });
});
