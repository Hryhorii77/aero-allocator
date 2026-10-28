import { describe, expect, it } from "vitest";
import { customChainSplit, percentToHundredths } from "./custom-chain-split";
import type { ChainBook } from "./all-chains-split";

const row = (gauge: string, symbol: string, fees: number, weight: number) => ({ gauge, symbol, feesUsdPerDay: fees, incentivesUsdPerDay: 0, weight, windowHours: 30 });
const books: ChainBook[] = [
  { chainId: 8453, name: "Base", rows: [row("0xb1", "A/B", 1000, 2_000_000), row("0xb2", "C/D", 600, 1_000_000)] },
  { chainId: 5042, name: "Arc", rows: [row("0xa1", "WETH/USDC", 400, 2_000_000)] },
  { chainId: 10, name: "OP", rows: [] },
];

describe("percentToHundredths", () => {
  it("reads whole and two-decimal percentages and treats empty as zero", () => {
    expect(percentToHundredths("30")).toBe(3000);
    expect(percentToHundredths("12.5")).toBe(1250);
    expect(percentToHundredths("12,25")).toBe(1225);
    expect(percentToHundredths("")).toBe(0);
    expect(percentToHundredths("100")).toBe(10_000);
  });
  it("rejects what isn't a percentage", () => {
    for (const bad of ["abc", "-5", "101", "12.345", "1e2", "30%"]) expect(percentToHundredths(bad), bad).toBeNull();
  });
});

describe("customChainSplit", () => {
  const shares = (arc: number) => [
    { chainId: 8453, name: "Base", hundredths: 10_000 - arc },
    { chainId: 5042, name: "Arc", hundredths: arc },
  ];
  it("gives each chain its share, with that chain's best gauges, and every gauge's share adding up to its chain's", () => {
    const r = customChainSplit(shares(3000), 100_000, books);
    if ("error" in r) throw new Error(r.error);
    expect(r.chains.map((c) => [c.name, c.pct])).toEqual([["Base", 70], ["Arc", 30]]);
    for (const c of r.chains) expect(c.parts.reduce((s, p) => s + p.pct, 0)).toBeCloseTo(c.pct, 6);
    expect(r.chains.find((c) => c.name === "Arc")!.parts[0].gauge).toBe("0xa1");
    expect(r.usdPerDay).toBeGreaterThan(0);
  });
  it("leaves a chain with no share out, and plans Arc alone at 100%", () => {
    const r = customChainSplit([{ chainId: 8453, name: "Base", hundredths: 0 }, { chainId: 5042, name: "Arc", hundredths: 10_000 }], 100_000, books);
    if ("error" in r) throw new Error(r.error);
    expect(r.chains.map((c) => c.name)).toEqual(["Arc"]);
  });
  it("refuses shares that don't add up, nothing chosen, or a chain with nothing to rank", () => {
    expect(customChainSplit([{ chainId: 8453, name: "Base", hundredths: 5000 }], 100_000, books)).toEqual({ error: "The shares must add up to 100%." });
    expect(customChainSplit([{ chainId: 8453, name: "Base", hundredths: 0 }], 100_000, books)).toEqual({ error: "Give at least one chain a share." });
    const r = customChainSplit([{ chainId: 8453, name: "Base", hundredths: 8000 }, { chainId: 10, name: "OP", hundredths: 2000 }], 100_000, books);
    expect(r).toEqual({ error: "No gauge on OP has a fee estimate yet, so a share there can't be planned." });
  });
});
