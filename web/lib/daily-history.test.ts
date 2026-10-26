import { describe, expect, it } from "vitest";
import { dailyForGauge, DAY_SEC, nextDayToRecord, RETAIN_DAILY_DAYS, rollupDays } from "./daily-history";
import type { WeightHistory } from "./weight-history";

const A = "0xaaaa";
const B = "0xbbbb";
const day = (d: number, hour = 0) => d * DAY_SEC + hour * 3600;
const NOW = day(105, 2); // 02:00 on day 105

describe("nextDayToRecord", () => {
  it("starts at the first fully covered day and stops before today", () => {
    expect(nextDayToRecord(null, day(100, 5), NOW)).toBe(101);
    expect(nextDayToRecord(null, day(100), NOW)).toBe(100);
  });
  it("continues after the last recorded day and is null when caught up", () => {
    const h = { version: 1 as const, chainId: 1, gauges: [], seen: [], points: [{ d: 103, f: [], w: [], i: [] }] };
    expect(nextDayToRecord(h, day(90), NOW)).toBe(104);
    expect(nextDayToRecord({ ...h, points: [{ d: 104, f: [], w: [], i: [] }] }, day(90), NOW)).toBeNull();
  });
});

describe("rollupDays", () => {
  const releases = [
    // A: first release (dropped, it dumps an unknown backlog), then $10 on day 103 and $5 + $2.5 on day 104
    { gauge: A, releases: [{ t: day(102, 3), usd: 99 }, { t: day(103, 5), usd: 10 }, { t: day(104, 1), usd: 5 }, { t: day(104, 20), usd: 2.5 }] },
    { gauge: B, releases: [] },
  ];

  it("records each finished day's fees per gauge, leaving out a gauge's first release and today", () => {
    const h = rollupDays(null, 8453, [...releases, { gauge: A, releases: [] }].slice(0, 2), day(102), null, NOW)!;
    expect(h.points.map((p) => p.d)).toEqual([102, 103, 104]);
    const a = h.gauges.indexOf(A);
    expect(h.points.map((p) => p.f[a])).toEqual([0, 10, 7.5]);
    expect(h.seen).toEqual([1, 0]);
  });

  it("never counts the first release again once it has been seen", () => {
    const first = rollupDays(null, 8453, releases, day(102), null, day(104, 2))!; // days 102-103
    const next = rollupDays(first, 8453, [{ gauge: A, releases: releases[0].releases.slice(1) }, releases[1]], day(102), null, NOW)!;
    expect(next.points.map((p) => p.d)).toEqual([102, 103, 104]);
    expect(next.points[2].f[next.gauges.indexOf(A)]).toBe(7.5);
  });

  it("takes weight and incentives from the day's last snapshot", () => {
    const wh: WeightHistory = { version: 1, chainId: 8453, gauges: [B, A], points: [
      { t: day(103, 1), w: [1, 2], i: [0, 0] },
      { t: day(103, 23), w: [100, 200], i: [7, 9] },
    ] };
    const h = rollupDays(null, 8453, releases, day(102), wh, NOW)!;
    const p103 = h.points.find((p) => p.d === 103)!;
    expect(p103.w[h.gauges.indexOf(A)]).toBe(200);
    expect(p103.i[h.gauges.indexOf(B)]).toBe(7);
    expect(h.points.find((p) => p.d === 102)!.w).toEqual([]);
  });

  it("returns the record untouched when no day has finished since the last one", () => {
    const h = rollupDays(null, 8453, releases, day(102), null, NOW)!;
    expect(rollupDays(h, 8453, releases, day(102), null, day(105, 20))).toBe(h);
  });

  it("does not record a day the fee record only covers part of", () => {
    const h = rollupDays(null, 8453, releases, day(104, 12), null, NOW);
    expect(h).toBeNull();
  });

  it("drops days older than the retention", () => {
    const old = { version: 1 as const, chainId: 8453, gauges: [A], seen: [1], points: [{ d: 5, f: [1], w: [], i: [] }, { d: 104 - 1, f: [1], w: [], i: [] }] };
    const h = rollupDays(old, 8453, [{ gauge: A, releases: [] }], day(100), null, NOW)!;
    expect(h.points.some((p) => p.d === 5)).toBe(false);
    expect(h.points[h.points.length - 1].d).toBe(104);
    expect(RETAIN_DAILY_DAYS).toBe(90);
  });
});

describe("dailyForGauge", () => {
  it("returns one gauge's days, with unknown weights as null", () => {
    const h = { version: 1 as const, chainId: 1, gauges: [A, B], seen: [1, 1], points: [{ d: 10, f: [3, 4], w: [], i: [] }, { d: 11, f: [5, 6], w: [50, 60], i: [1, 2] }] };
    expect(dailyForGauge(h, B)).toEqual([
      { t: 10 * DAY_SEC, feesUsd: 4, weight: null, incentivesUsdPerWeek: null },
      { t: 11 * DAY_SEC, feesUsd: 6, weight: 60, incentivesUsdPerWeek: 2 },
    ]);
    expect(dailyForGauge(h, "0xcccc")).toEqual([]);
    expect(dailyForGauge(null, A)).toEqual([]);
  });
});
