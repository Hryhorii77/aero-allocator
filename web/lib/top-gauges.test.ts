import { describe, expect, it } from "vitest";
import type { GaugeRow } from "./gauges";
import { MAX_LIMIT, topGauges, topGaugesAllChains } from "./top-gauges";

const g = (n: number, weight: number, extra: Partial<GaugeRow> = {}): GaugeRow => ({
  gauge: `0x${n.toString(16).padStart(40, "0")}` as `0x${string}`,
  pool: `0x${(n + 100).toString(16).padStart(40, "0")}` as `0x${string}`,
  symbol: `P${n}/USDC`,
  weight,
  sharePct: 1,
  capPerWeek: 1,
  activated: true,
  incentivesUsdPerWeek: 0,
  incentivesUsdPer1k: 0,
  poolType: "CL100",
  ...extra,
});
const fee = (n: number, usd: number, h = 40, extra: object = {}) => ({ gauge: g(n, 1).gauge, feesUsdPerDay: usd, windowHours: h, ...extra });
const feesOf = (rows: ReturnType<typeof fee>[], aeroUsd?: number) => ({ chainId: 8453, generatedAt: 1_700_000_000_000, windowHours: 40, ...(aeroUsd ? { aeroUsd } : {}), fees: rows });
const NOW = 1_700_000_000;

describe("topGauges", () => {
  it("ranks by what the amount earns per day after it joins the gauge, best first, and honours the limit", () => {
    const out = topGauges(8453, [g(1, 1_000_000), g(2, 200_000), g(3, 5_000_000)], feesOf([fee(1, 100), fee(2, 100), fee(3, 600)]), 10_000, 2, 169_200, NOW);
    expect(out.gauges[0].label).toBe("P2/USDC · CL100");
    expect(out.gauges).toHaveLength(2);
    // gauge 2: 100 x 10,000 / 210,000 = $4.7619
    expect(out.gauges[0].usdPerDay).toBeCloseTo(4.7619, 3);
    expect(out.gauges[0].usdPerDay).toBeGreaterThanOrEqual(out.gauges[1].usdPerDay);
    expect(out.waitHours).toBe(47);
    expect(out.amount).toBe(10_000);
  });

  it("labels the pace, the steadiness and an incentive that ends inside the wait, like the page", () => {
    const inc = { incentivesUsdPerWeek: 700, incentivePrograms: [{ end: NOW + 10 * 3600, usdPerDay: 100 }] };
    const out = topGauges(
      8453,
      [g(1, 200_000), g(2, 200_000, inc)],
      feesOf([fee(1, 500, 40, { steady: { buckets: 6, paying: 6 } }), fee(2, 20, 3)], 0.5),
      10_000,
      10,
      169_200,
      NOW,
    );
    const a = out.gauges.find((x) => x.label.startsWith("P1"))!;
    const b = out.gauges.find((x) => x.label.startsWith("P2"))!;
    expect(a).toMatchObject({ pace: "solid", steady: "6/6", steadiest: true, incentivesNote: null });
    expect(b.pace).toBe("thin");
    expect(b.incentivesNote).toBe("incentives end in 10 h");
    expect(b.lowUsdPerDay).toBeLessThan(b.usdPerDay);
    expect(a.aprPct).not.toBeNull();
  });

  it("leaves out gauges that are too light or have no fee estimate, and caps the limit", () => {
    const many = Array.from({ length: 40 }, (_, i) => g(i + 1, 200_000 + i));
    const out = topGauges(8453, [...many, g(99, 10), g(98, 500_000)], feesOf([...many.map((_, i) => fee(i + 1, 100 + i)), fee(99, 1_000_000)]), 10_000, 999, undefined, NOW);
    expect(out.gauges).toHaveLength(MAX_LIMIT);
    expect(out.gauges.some((x) => x.label.startsWith("P99/"))).toBe(false);
    expect(out.gauges.some((x) => x.label.startsWith("P98/"))).toBe(false);
  });
});

describe("topGaugesAllChains", () => {
  it("ranks each chain against its own fees, merges best first with each row's chain, and keeps a shared address apart", () => {
    // Gauge 1 exists on both chains: on Ethereum it pays 4x, so it must rank first and still appear once per chain.
    const base = { chainId: 8453, gauges: [g(1, 1_000_000), g(2, 1_000_000)], fees: feesOf([fee(1, 100), fee(2, 300)], 0.5), cooldownSec: 169_200 };
    const eth = { chainId: 1, gauges: [g(1, 1_000_000)], fees: { ...feesOf([fee(1, 400)]), chainId: 1 } };
    const out = topGaugesAllChains([base, eth], [5042], 10_000, 10, NOW, 8453);
    expect(out.chainId).toBe("all");
    expect(out.gauges.map((r) => [r.chainId, r.label])).toEqual([
      [1, "P1/USDC · CL100"],
      [8453, "P2/USDC · CL100"],
      [8453, "P1/USDC · CL100"],
    ]);
    expect(out.skipped).toEqual([5042]);
    expect(out.aeroUsd).toBe(0.5);
    expect(out.waitHours).toBe(47);
    expect(topGaugesAllChains([base, eth], [], 10_000, 2, NOW, 8453).gauges).toHaveLength(2);
  });
});

