import { describe, expect, it } from "vitest";
import { MIN_RANK_WEIGHT, rankByUsdPerDay } from "./gauge-yield";
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
