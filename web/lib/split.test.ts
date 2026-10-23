import { describe, expect, it } from "vitest";
import { bestSplit } from "./split";

const g = (n: number, rate: number, weight: number) => ({ gauge: `0x${n.toString(16).padStart(40, "0")}` as `0x${string}`, symbol: `P${n}`, rate, weight });

describe("bestSplit", () => {
  it("puts everything in one gauge when the amount is tiny next to its weight", () => {
    const s = bestSplit([g(1, 1000, 1_000_000), g(2, 500, 1_000_000)], 100)!;
    expect(s.parts).toHaveLength(1);
    expect(s.parts[0].pct).toBe(100);
  });

  it("spreads a big amount across gauges because each one dilutes", () => {
    const s = bestSplit([g(1, 1000, 100_000), g(2, 800, 100_000), g(3, 50, 100_000)], 1_000_000)!;
    expect(s.parts.length).toBeGreaterThan(1);
    expect(s.usdPerDay).toBeGreaterThan(s.bestSingleUsdPerDay);
    expect(s.parts.reduce((a, p) => a + p.pct, 0)).toBeCloseTo(100, 6);
    expect(s.parts[0].pct).toBeGreaterThan(s.parts[1].pct);
  });

  it("is never worse than the best single gauge, and beats any equal split", () => {
    const gauges = [g(1, 900, 200_000), g(2, 700, 150_000), g(3, 300, 40_000), g(4, 100, 10_000)];
    for (const amount of [1_000, 50_000, 500_000, 5_000_000]) {
      const s = bestSplit(gauges, amount)!;
      expect(s.usdPerDay).toBeGreaterThanOrEqual(s.bestSingleUsdPerDay - 1e-6);
      const eq = gauges.reduce((t, x) => t + (x.rate * (amount / 4)) / (x.weight + amount / 4), 0);
      expect(s.usdPerDay).toBeGreaterThanOrEqual(eq - 1e-6);
    }
  });

  it("drops parts under 1% and caps the number of gauges", () => {
    const many = Array.from({ length: 30 }, (_, i) => g(i + 1, 1000 - i * 10, 100_000));
    const s = bestSplit(many, 10_000_000, 5)!;
    expect(s.parts.length).toBeLessThanOrEqual(5);
    expect(s.parts.every((p) => p.pct >= 1)).toBe(true);
    expect(s.parts.reduce((a, p) => a + p.pct, 0)).toBeCloseTo(100, 6);
  });

  it("returns null with no amount or nothing that pays", () => {
    expect(bestSplit([g(1, 100, 1000)], 0)).toBeNull();
    expect(bestSplit([g(1, 0, 1000)], 100)).toBeNull();
    expect(bestSplit([], 100)).toBeNull();
  });
});
