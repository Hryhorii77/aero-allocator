import { describe, expect, it } from "vitest";
import { copyShares, priceCopy, topByPower } from "./top-allocators";

describe("topByPower", () => {
  it("lists the largest positions first, leaves out empty ones, and keeps the limit", () => {
    const ps = [{ tokenId: 1, power: 5 }, { tokenId: 2, power: 0 }, { tokenId: 3, power: 50 }, { tokenId: 4, power: 50 }, { tokenId: 5, power: 1 }];
    expect(topByPower(ps, 3).map((p) => p.tokenId)).toEqual([3, 4, 1]);
    expect(topByPower(ps).some((p) => p.tokenId === 2)).toBe(false);
  });
});

describe("copyShares", () => {
  it("turns raw amounts into percentages that add up to exactly 100, largest first", () => {
    const out = copyShares([{ gauge: "0xa", raw: 1n }, { gauge: "0xb", raw: 1n }, { gauge: "0xc", raw: 1n }]);
    expect(out.reduce((s, p) => s + Math.round(p.pct * 100), 0)).toBe(10_000);
    expect(out.map((p) => p.pct).sort()).toEqual([33.33, 33.33, 33.34]);
  });
  it("drops empty gauges and the zero address, and is empty with nothing allocated", () => {
    expect(copyShares([{ gauge: "0xa", raw: 3n }, { gauge: "0xb", raw: 0n }, { gauge: "0x0000000000000000000000000000000000000000", raw: 9n }])).toEqual([{ gauge: "0xa", pct: 100 }]);
    expect(copyShares([])).toEqual([]);
  });
  it("stays exact with real 18-decimal amounts", () => {
    const raw = [106_692_444n, 3n, 77_777_777n].map((n) => n * 10n ** 18n + 123n);
    const out = copyShares(raw.map((r, i) => ({ gauge: `0x${i}`, raw: r })));
    expect(out.reduce((s, p) => s + Math.round(p.pct * 100), 0)).toBe(10_000);
  });
});

describe("priceCopy", () => {
  const rows = [
    { gauge: "0xA" as `0x${string}`, feesUsdPerDay: 1000, incentivesUsdPerDay: 0, weight: 990_000 },
    { gauge: "0xB" as `0x${string}`, feesUsdPerDay: 5000, incentivesUsdPerDay: 0, weight: 990_000, spike: { typicalUsdPerDay: 500 } },
  ];
  it("prices the split for your amount after it joins each gauge, counting a burst at its usual level", () => {
    const { usdPerDay, unpriced } = priceCopy([{ gauge: "0xa", pct: 50 }, { gauge: "0xb", pct: 50 }], rows, 20_000);
    // 10,000 into each: 1000 x 10k/1M + 500 x 10k/1M = 10 + 5
    expect(usdPerDay).toBeCloseTo(15, 6);
    expect(unpriced).toBe(0);
  });
  it("counts a gauge with no estimate as earning nothing, and says how many there were", () => {
    expect(priceCopy([{ gauge: "0xa", pct: 50 }, { gauge: "0xdead", pct: 50 }], rows, 20_000)).toEqual({ usdPerDay: 10, unpriced: 1 });
  });
});
