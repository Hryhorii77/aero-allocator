import { describe, expect, it } from "vitest";
import { analysePosition } from "./position-advice";
import { opportunityLine, totalCostText } from "./opportunity";
import type { GaugeList, GaugeRow } from "./gauges";
import type { GaugeFees } from "./gauge-fees-read";

const addr = (n: number) => `0x${n.toString(16).padStart(40, "0")}` as `0x${string}`;
const row = (n: number, weight: number): GaugeRow => ({ gauge: addr(n), pool: addr(n + 100), symbol: `P${n}`, weight, sharePct: 1, capPerWeek: 1, activated: true, incentivesUsdPerWeek: 0, incentivesUsdPer1k: 0 });
const list = (rows: GaugeRow[]): GaugeList => ({ chainId: 8453, generatedAt: 0, totalWeight: 1, gauges: rows });
const fees = (pairs: Array<[number, number, number]>): GaugeFees => ({ chainId: 8453, generatedAt: 0, windowHours: 30, fees: pairs.map(([n, usd, h]) => ({ gauge: addr(n), feesUsdPerDay: usd, windowHours: h })) });
const E18 = 10n ** 18n;
const pos = (over = {}) => ({ votingPower: 10_000, staked: 10_000, parkedRaw: 0n, onBaseRaw: 10_000n * E18, lastAllocatedSec: 0, ...over });
const base = { cooldownSec: 169_200, nowSec: 1_800_000_000 };
const g = list([row(1, 1_000_000), row(2, 300_000)]);
const f = fees([[1, 100, 30], [2, 5000, 30]]);

describe("opportunityLine", () => {
  it("counts the gain as the cost of staying when the advice is to switch", () => {
    const a = analysePosition({ ...base, position: pos(), current: [{ gauge: addr(1), symbol: "P1", pct: 100 }], gauges: g, fees: f });
    const line = opportunityLine(a);
    expect(line.costUsdPerDay).toBeCloseTo(a.gainUsdPerDay ?? NaN, 6);
    expect(line.costUsdPerDay).toBeGreaterThan(0);
    expect(line.text).toMatch(/staying costs about \$\d/);
  });

  it("counts the whole best split for idle power", () => {
    const a = analysePosition({ ...base, position: pos({ parkedRaw: 10_000n * E18, onBaseRaw: 0n }), current: [], gauges: g, fees: f });
    const line = opportunityLine(a);
    expect(line.costUsdPerDay).toBeCloseTo(a.best?.usdPerDay ?? NaN, 6);
    expect(line.text).toMatch(/Idle/);
  });

  it("gives no dollar figure for an idle position too small to earn a cent", () => {
    const a = analysePosition({ ...base, position: pos({ votingPower: 0.01, staked: 0.01, parkedRaw: E18 / 100n, onBaseRaw: 0n }), current: [], gauges: g, fees: f });
    expect(opportunityLine(a)).toEqual({ text: "Idle, so it earns nothing now.", costUsdPerDay: 0 });
  });

  it("costs nothing when staying is fine, and says why", () => {
    const a = analysePosition({ ...base, position: pos(), current: [{ gauge: addr(2), symbol: "P2", pct: 100 }], gauges: g, fees: f });
    const line = opportunityLine(a);
    expect(line.costUsdPerDay).toBe(0);
    expect(line.text).toMatch(/as much as the best split|not enough more to be worth the 47-hour wait/);
  });

  it("does not count a gain that rests on thin history, and shows the reason instead", () => {
    const a = analysePosition({ ...base, position: pos(), current: [{ gauge: addr(1), symbol: "P1", pct: 100 }], gauges: g, fees: fees([[1, 100, 30], [2, 5000, 2]]) });
    const line = opportunityLine(a);
    expect(a.advice.action).toBe("unknown");
    expect(line.costUsdPerDay).toBe(0);
    expect(line.text).toMatch(/under 6 hours/);
  });

  it("says nothing for a position with no power", () => {
    const a = analysePosition({ ...base, position: pos({ parkedRaw: 0n, onBaseRaw: 0n, votingPower: 0, staked: 0 }), current: [], gauges: g, fees: f });
    expect(opportunityLine(a)).toEqual({ text: null, costUsdPerDay: 0 });
  });
});

describe("totalCostText", () => {
  it("adds the positions up, per day and over 30 days", () => {
    expect(totalCostText([1.5, 0, 0.5])).toMatch(/\$2\.00 a day more \(about \$60\.00 over 30 days\)/);
  });
  it("is silent when there is nothing to gain", () => {
    expect(totalCostText([])).toBeNull();
    expect(totalCostText([0, 0.004])).toBeNull();
  });
});
