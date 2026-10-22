import { describe, expect, it } from "vitest";
import { activeIncentiveUsdPerWeek, buildGaugeRows, gaugeWeight, weeklyCap } from "./gauges";

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

describe("activeIncentiveUsdPerWeek", () => {
  const AERO = "0xaero" as const;
  const USDC = "0xusdc" as const;
  const price = (t: string) => (t === AERO ? { priceUsd: 2, decimals: 18 } : t === USDC ? { priceUsd: 1, decimals: 6 } : null);
  // 1 AERO per second at a 1e18 rate scale.
  const aeroPerSec = (n: bigint) => ({ token: AERO, rate: n * 10n ** 18n * 10n ** 18n, start: 100, end: 1_000_000 });

  it("prices a streaming program per week", () => {
    expect(activeIncentiveUsdPerWeek([aeroPerSec(1n)], 500, price)).toBe(604_800 * 2);
  });
  it("respects each token's decimals", () => {
    const usdc = { token: USDC, rate: 1_000_000n * 10n ** 18n, start: 0, end: 10 }; // 1 USDC per second
    expect(activeIncentiveUsdPerWeek([usdc], 5, price)).toBe(604_800);
  });
  it("ignores programs not yet started, already ended, or without a price", () => {
    const unknown = { token: "0xnone" as const, rate: 10n ** 36n, start: 0, end: 10 };
    expect(activeIncentiveUsdPerWeek([{ ...aeroPerSec(1n), start: 600 }, { ...aeroPerSec(1n), end: 500 }, unknown], 500, price)).toBe(0);
  });
});

describe("incentivesUsdPer1k", () => {
  it("divides weekly incentives by the gauge weight, per 1,000", () => {
    const { rows } = buildGaugeRows(
      [{ gauge: "0xa", pool: "0x1", symbol: "A/B", point: pt(0n, 0n, 0, 2000n * E18), capPerSec: 0n, activated: true, incentivesUsdPerWeek: 500 }],
      0,
    );
    expect(rows[0].incentivesUsdPer1k).toBe(250);
  });
});
