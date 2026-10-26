import { describe, expect, it } from "vitest";
import type { YieldRow } from "./gauge-yield";
import { currentLowUsdPerDay, lowFeeFactor, projectRange } from "./projection";
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
