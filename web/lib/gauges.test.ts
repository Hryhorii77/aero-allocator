import { describe, expect, it } from "vitest";
import { buildGaugeRows, gaugeWeight, weeklyCap } from "./gauges";

const E18 = 10n ** 18n;
const pt = (bias: bigint, slope: bigint, ts: number, perm: bigint) => ({ bias, slope, ts, permanentStakeBalance: perm });

describe("gaugeWeight", () => {
  it("decays the bias by slope since ts and adds the permanent part", () => {
    expect(gaugeWeight(pt(100n * E18, E18, 1000, 50n * E18), 1010)).toBe(140);
  });
  it("never goes below the permanent part once fully decayed", () => {
    expect(gaugeWeight(pt(10n * E18, E18, 1000, 5n * E18), 5000)).toBe(5);
  });
  it("does not run backwards if ts is in the future", () => {
    expect(gaugeWeight(pt(10n * E18, E18, 2000, 0n), 1000)).toBe(10);
  });
});

describe("weeklyCap", () => {
  it("scales a per-second cap to a week", () => {
    expect(weeklyCap(E18 / 2n)).toBe(0.5 * 604_800);
    expect(weeklyCap(0n)).toBe(0);
  });
});

describe("buildGaugeRows", () => {
  it("sorts heaviest first and shares sum to 100", () => {
    const base = { pool: "0x1" as const, symbol: "A/B", capPerSec: 0n, activated: true };
    const { rows, totalWeight } = buildGaugeRows(
      [
        { ...base, gauge: "0xa", point: pt(0n, 0n, 0, 10n * E18) },
        { ...base, gauge: "0xb", point: pt(0n, 0n, 0, 30n * E18) },
      ],
      100,
    );
    expect(totalWeight).toBe(40);
    expect(rows.map((r) => r.gauge)).toEqual(["0xb", "0xa"]);
    expect(rows[0].sharePct).toBe(75);
    expect(rows.reduce((a, r) => a + r.sharePct, 0)).toBe(100);
  });
  it("has zero shares when nothing is allocated", () => {
    const { rows } = buildGaugeRows(
      [{ gauge: "0xa", pool: "0x1", symbol: "A/B", point: pt(0n, 0n, 0, 0n), capPerSec: 0n, activated: false }],
      0,
    );
    expect(rows[0].sharePct).toBe(0);
  });
});
