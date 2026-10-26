import { describe, expect, it } from "vitest";
import { analysePosition, SWITCH_MIN_GAIN_USD_PER_DAY } from "./position-advice";
import type { GaugeList, GaugeRow } from "./gauges";
import type { GaugeFees } from "./gauge-fees-read";

const addr = (n: number) => `0x${n.toString(16).padStart(40, "0")}` as `0x${string}`;
const row = (n: number, weight: number): GaugeRow => ({ gauge: addr(n), pool: addr(n + 100), symbol: `P${n}`, weight, sharePct: 1, capPerWeek: 1, activated: true, incentivesUsdPerWeek: 0, incentivesUsdPer1k: 0 });
const list = (rows: GaugeRow[]): GaugeList => ({ chainId: 8453, generatedAt: 0, totalWeight: 1, gauges: rows });
const fees = (pairs: Array<[number, number, number]>): GaugeFees => ({ chainId: 8453, generatedAt: 0, windowHours: 30, fees: pairs.map(([n, usd, h]) => ({ gauge: addr(n), feesUsdPerDay: usd, windowHours: h })) });

const E18 = 10n ** 18n;
const NOW = 1_800_000_000;
const COOLDOWN = 169_200;
const pos = (over: Partial<Parameters<typeof analysePosition>[0]["position"]> = {}) => ({ votingPower: 10_000, staked: 10_000, parkedRaw: 0n, onBaseRaw: 10_000n * E18, lastAllocatedSec: 0, ...over });
const base = { cooldownSec: COOLDOWN, nowSec: NOW };

describe("analysePosition", () => {
  it("says stay when the position already sits in the best gauge", () => {
    const g = list([row(1, 1_000_000), row(2, 300_000)]);
    // Everything is in gauge 2, which pays far more per unit of weight, so no split beats it by enough.
    const a = analysePosition({ ...base, position: pos(), current: [{ gauge: addr(2), symbol: "P2", pct: 100 }], gauges: g, fees: fees([[1, 100, 30], [2, 5000, 30]]) });
    expect(a.advice.action).toBe("stay");
    expect(a.currentUsdPerDay).not.toBeNull();
    expect(a.best?.parts[0].symbol).toMatch(/P2/);
  });

  it("says switch, with the dollar gain, when a much better split exists and the wait is over", () => {
    const g = list([row(1, 1_000_000), row(2, 300_000)]);
    const a = analysePosition({ ...base, position: pos(), current: [{ gauge: addr(1), symbol: "P1", pct: 100 }], gauges: g, fees: fees([[1, 100, 30], [2, 5000, 30]]) });
    expect(a.advice.action).toBe("switch");
    expect(a.advice.canActNow).toBe(true);
    expect(a.gainUsdPerDay).toBeGreaterThan(SWITCH_MIN_GAIN_USD_PER_DAY);
    expect(a.advice.reason).toMatch(/\$\d+\.\d\d\/day more/);
  });

  it("keeps the advice but marks it as waiting while the 47-hour wait runs, with when it ends", () => {
    const g = list([row(1, 1_000_000), row(2, 300_000)]);
    const last = NOW - 3600;
    const a = analysePosition({ ...base, position: pos({ lastAllocatedSec: last }), current: [{ gauge: addr(1), symbol: "P1", pct: 100 }], gauges: g, fees: fees([[1, 100, 30], [2, 5000, 30]]) });
    expect(a.advice.action).toBe("switch");
    expect(a.advice.canActNow).toBe(false);
    expect(a.advice.readyAtSec).toBe(last + COOLDOWN);
    expect(a.cooldown.ready).toBe(false);
  });

  it("says allocate for idle power and none for an empty position", () => {
    const g = list([row(2, 300_000)]);
    const f = fees([[2, 5000, 30]]);
    const idle = analysePosition({ ...base, position: pos({ parkedRaw: 10_000n * E18, onBaseRaw: 0n }), current: [], gauges: g, fees: f });
    expect(idle.advice.action).toBe("allocate");
    const empty = analysePosition({ ...base, position: pos({ parkedRaw: 0n, onBaseRaw: 0n, votingPower: 0, staked: 0 }), current: [], gauges: g, fees: f });
    expect(empty.advice.action).toBe("none");
    expect(empty.advice.canActNow).toBe(false);
  });

  it("does not guess when nothing can be priced", () => {
    const g = list([row(1, 1_000_000)]);
    const none = analysePosition({ ...base, position: pos(), current: [{ gauge: addr(1), symbol: "P1", pct: 100 }], gauges: g, fees: fees([]) });
    expect(none.advice.action).toBe("unknown");
    expect(none.best).toBeNull();
    expect(none.confidence).toBeNull();
    const unpriced = analysePosition({ ...base, position: pos(), current: [{ gauge: addr(9), symbol: "P9", pct: 100 }], gauges: list([row(2, 300_000)]), fees: fees([[2, 5000, 30]]) });
    expect(unpriced.advice.action).toBe("unknown");
    expect(unpriced.unmeasured).toEqual(["P9"]);
  });

  it("takes the position's own power out of the gauge weight before ranking", () => {
    // 10,000 of the 310,000 weight in gauge 1 is this position's own; alone it would hold 100% of its share.
    const g = list([row(1, 310_000)]);
    const a = analysePosition({ ...base, position: pos(), current: [{ gauge: addr(1), symbol: "P1", pct: 100 }], gauges: g, fees: fees([[1, 1000, 30]]) });
    // best = all in gauge 1 at weight 300,000 + 10,000 = 310,000: the same as now, so no gain.
    expect(a.gainUsdPerDay).toBeCloseTo(0, 6);
    expect(a.advice.action).toBe("stay");
  });

  it("does not recommend a move that rests on under 6 hours of fee history", () => {
    const g = list([row(1, 1_000_000), row(2, 300_000)]);
    const a = analysePosition({ ...base, position: pos(), current: [{ gauge: addr(1), symbol: "P1", pct: 100 }], gauges: g, fees: fees([[1, 100, 3], [2, 5000, 3]]) });
    expect(a.gainUsdPerDay).toBeGreaterThan(SWITCH_MIN_GAIN_USD_PER_DAY);
    expect(a.advice.action).toBe("unknown");
    expect(a.advice.reason).toMatch(/under 6 hours/);
    expect(a.confidence).toBe("thin");
  });

  it("reports how steady the fee pace is from the weakest gauge in the best split", () => {
    const g = list([row(1, 300_000), row(2, 300_000)]);
    const a = analysePosition({ ...base, position: pos(), current: [], gauges: g, fees: fees([[1, 3000, 30], [2, 3000, 3]]) });
    expect(a.windowHours).toBe(3);
    expect(a.confidence).toBe("thin");
  });

  it("gives a low-case gain that is never above the gain, and never negative", () => {
    const g = list([row(1, 1_000_000), row(2, 300_000)]);
    const a = analysePosition({ ...base, position: pos(), current: [{ gauge: addr(1), symbol: "P1", pct: 100 }], gauges: g, fees: fees([[1, 100, 30], [2, 5000, 30]]) });
    expect(a.gainLowUsdPerDay).not.toBeNull();
    expect(a.gainLowUsdPerDay).toBeGreaterThanOrEqual(0);
    expect(a.gainLowUsdPerDay).toBeLessThanOrEqual(a.gainUsdPerDay ?? Infinity);
    expect(a.bestLowUsdPerDay).toBeLessThan(a.best?.usdPerDay ?? 0);
    const stay = analysePosition({ ...base, position: pos(), current: [{ gauge: addr(2), symbol: "P2", pct: 100 }], gauges: g, fees: fees([[1, 100, 30], [2, 5000, 30]]) });
    expect(stay.gainLowUsdPerDay ?? 0).toBeLessThanOrEqual(Math.max(0, stay.gainUsdPerDay ?? 0));
  });
});
