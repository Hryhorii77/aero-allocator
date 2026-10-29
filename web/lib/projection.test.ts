import { describe, expect, it } from "vitest";
import type { YieldRow } from "./gauge-yield";
import { currentLowUsdPerDay, lowFeeFactor, lowFeesUsdPerDay, lowUsdPerDayOf, projectRange } from "./projection";
import type { Split } from "./split";

const row = (o: Partial<YieldRow> & { gauge: string }): YieldRow => ({ symbol: "A/B", feesUsdPerDay: 100, incentivesUsdPerDay: 0, usdPerDay: 0, sharePct: 0, weight: 1000, windowHours: 48, ...o }) as YieldRow;
const split = (parts: Array<{ gauge: string; amount: number; usdPerDay: number }>): Split => ({
  parts: parts.map((p) => ({ ...p, symbol: "A/B", pct: 100 })) as Split["parts"],
  usdPerDay: parts.reduce((s, p) => s + p.usdPerDay, 0),
  bestSingleUsdPerDay: 0,
});

describe("projectRange", () => {
  it("halves fees where the record is too short, and keeps incentives", () => {
    // amount 1000 into weight 1000: share 0.5. pace = (100 + 40) * 0.5 = 70; low = (50 + 40) * 0.5 = 45
    const r = projectRange([row({ gauge: "0xa", incentivesUsdPerDay: 40 })], split([{ gauge: "0xa", amount: 1000, usdPerDay: 70 }]));
    expect(r.paceUsdPerDay).toBe(70);
    expect(r.lowUsdPerDay).toBeCloseTo(45, 6);
  });
  it("uses the share of paying half-days when the record is long enough, never below half", () => {
    const steady = projectRange([row({ gauge: "0xa", steady: { buckets: 8, paying: 8 } })], split([{ gauge: "0xa", amount: 1000, usdPerDay: 50 }]));
    expect(steady.lowUsdPerDay).toBeCloseTo(50, 6);
    const patchy = projectRange([row({ gauge: "0xa", steady: { buckets: 8, paying: 2 } })], split([{ gauge: "0xa", amount: 1000, usdPerDay: 50 }]));
    expect(patchy.lowUsdPerDay).toBeCloseTo(25, 6);
  });
  it("sums the parts and never goes above the pace figure", () => {
    const r = projectRange(
      [row({ gauge: "0xa" }), row({ gauge: "0xb", feesUsdPerDay: 10 })],
      split([
        { gauge: "0xa", amount: 1000, usdPerDay: 50 },
        { gauge: "0xb", amount: 1000, usdPerDay: 5 },
      ]),
    );
    expect(r.lowUsdPerDay).toBeCloseTo(27.5, 6);
    expect(r.lowUsdPerDay).toBeLessThanOrEqual(r.paceUsdPerDay);
  });
});

describe("lowFeeFactor / currentLowUsdPerDay", () => {
  it("is half with no record, the paying share otherwise, never under half", () => {
    expect(lowFeeFactor(undefined)).toBe(0.5);
    expect(lowFeeFactor({ buckets: 8, paying: 2 })).toBe(0.5);
    expect(lowFeeFactor({ buckets: 8, paying: 6 })).toBe(0.75);
  });
  it("prices where a position sits with fees cut, incentives kept, own power in the weight", () => {
    // own 1000 into a gauge already holding 1000 (includes own): share 0.5; (100*0.5 + 40) * 0.5 = 45
    const low = currentLowUsdPerDay([{ gauge: "0xa", feesUsdPerDay: 100, incentivesUsdPerDay: 40, weight: 1000 }], [{ gauge: "0xa", pct: 100 }], 1000);
    expect(low).toBeCloseTo(45, 6);
    expect(currentLowUsdPerDay([], [{ gauge: "0xa", pct: 100 }], 1000)).toBe(0);
  });
});

describe("a spiking gauge's low case", () => {
  it("counts fees at the usual level, not the paying share, and never above the pace", () => {
    expect(lowFeesUsdPerDay({ feesUsdPerDay: 2800, steady: { buckets: 6, paying: 6 }, spike: { typicalUsdPerDay: 400 } })).toBe(400);
    expect(lowFeesUsdPerDay({ feesUsdPerDay: 300, spike: { typicalUsdPerDay: 400 } })).toBe(300);
    expect(lowFeesUsdPerDay({ feesUsdPerDay: 100, steady: { buckets: 8, paying: 8 } })).toBe(100);
  });
  it("feeds the range, the current position and a single row", () => {
    const rows = [row({ gauge: "0xa", feesUsdPerDay: 1000, incentivesUsdPerDay: 0, spike: { typicalUsdPerDay: 100 } })];
    // amount 1000 into weight 1000: share 0.5; pace 500, low 50
    const r = projectRange(rows, split([{ gauge: "0xa", amount: 1000, usdPerDay: 500 }]));
    expect(r.lowUsdPerDay).toBeCloseTo(50, 6);
    expect(currentLowUsdPerDay(rows, [{ gauge: "0xa", pct: 100 }], 1000)).toBeCloseTo(50, 6);
    expect(lowUsdPerDayOf({ ...rows[0], sharePct: 50 })).toBeCloseTo(50, 6);
  });
});

describe("incentives that end inside the wait", () => {
  it("counts them at their average over the wait in the low case, not at what streams now", () => {
    // weight 1000, amount 1000: share 0.5. Fees 100 (halved to 50 for lack of record), incentives 40 now but 10 on average over the wait.
    const r = projectRange([row({ gauge: "0xa", incentivesUsdPerDay: 40, incentivesLowUsdPerDay: 10 })], split([{ gauge: "0xa", amount: 1000, usdPerDay: 70 }]));
    expect(r.paceUsdPerDay).toBe(70);
    expect(r.lowUsdPerDay).toBeCloseTo((50 + 10) * 0.5, 6);
  });
  it("prices a gauge row and a held position the same way", () => {
    const y = row({ gauge: "0xa", incentivesUsdPerDay: 40, incentivesLowUsdPerDay: 10, sharePct: 50 });
    expect(lowUsdPerDayOf(y)).toBeCloseTo(30, 6);
    expect(currentLowUsdPerDay([y], [{ gauge: "0xa", pct: 100 }], 1000)).toBeCloseTo(30, 6);
  });
  it("never counts more incentives than stream now", () => {
    const y = row({ gauge: "0xa", incentivesUsdPerDay: 40, incentivesLowUsdPerDay: 90, sharePct: 50 });
    expect(lowUsdPerDayOf(y)).toBeCloseTo((50 + 40) * 0.5, 6);
  });
});
