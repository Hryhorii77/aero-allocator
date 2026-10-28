import { describe, expect, it } from "vitest";
import { bestAcrossChains, type ChainBook } from "./all-chains-split";

const row = (gauge: string, symbol: string, fees: number, weight: number, extra: object = {}) => ({ gauge, symbol, feesUsdPerDay: fees, incentivesUsdPerDay: 0, weight, windowHours: 30, ...extra });
const base: ChainBook = { chainId: 8453, name: "Base", rows: [row("0xb1", "WETH/USDC", 1000, 2_000_000), row("0xb2", "AERO/USDC", 600, 1_000_000)] };
const op: ChainBook = { chainId: 10, name: "OP", rows: [row("0xa1", "OP/USDC", 75, 100_000)] };
const free = () => 0;

describe("bestAcrossChains", () => {
  it("spreads an amount over chains when the extra fee is cheap", () => {
    const r = bestAcrossChains([base, op], 50_000, 7, free)!;
    expect(r.best.chains.map((c) => c.name)).toEqual(expect.arrayContaining(["Base", "OP"]));
    expect(r.best.chains.reduce((s, c) => s + c.pct, 0)).toBeCloseTo(100, 1);
    expect(r.best.usdPerDay).toBeGreaterThan(r.baseOnly!.usdPerDay);
    expect(r.best.netUsd).toBeGreaterThanOrEqual(r.baseOnly!.netUsd);
  });

  it("stays on Base when the other chain's fee is more than it adds over the horizon", () => {
    const dear = (chainId: number) => (chainId === 10 ? 500 : 0);
    const r = bestAcrossChains([base, op], 50_000, 2, dear)!;
    expect(r.best.chains.map((c) => c.name)).toEqual(["Base"]);
    expect(r.best.feeUsd).toBe(0);
    expect(r.best.netUsd).toBeCloseTo(r.baseOnly!.netUsd, 6);
  });

  it("charges the fee per chain used, by the number of gauges placed there", () => {
    const seen: Array<[number, number]> = [];
    const r = bestAcrossChains([base, op], 50_000, 30, (c, n) => (seen.push([c, n]), 1.5))!;
    const opShare = r.best.chains.find((c) => c.chainId === 10);
    expect(opShare?.feeUsd).toBe(1.5);
    expect(r.best.feeUsd).toBe(1.5);
    expect(r.best.netUsd).toBeCloseTo(r.best.usdPerDay * 30 - 1.5, 6);
    expect(seen.every(([c]) => c === 10)).toBe(true);
  });

  it("marks a split that includes a spiking or thin gauge", () => {
    const spiky: ChainBook = { chainId: 10, name: "OP", rows: [row("0xa1", "OP/USDC", 900, 100_000, { spike: { typicalUsdPerDay: 100 } })] };
    expect(bestAcrossChains([base, spiky], 50_000, 7, free)!.best.confidence).toBe("spiky");
    const thin: ChainBook = { chainId: 10, name: "OP", rows: [row("0xa1", "OP/USDC", 900, 100_000, { windowHours: 3 })] };
    expect(bestAcrossChains([base, thin], 50_000, 7, free)!.best.confidence).toBe("thin");
  });

  it("returns null with no amount, no horizon or nothing to rank", () => {
    expect(bestAcrossChains([base], 0, 7, free)).toBeNull();
    expect(bestAcrossChains([base], 100, 0, free)).toBeNull();
    expect(bestAcrossChains([{ ...base, rows: [] }], 100, 7, free)).toBeNull();
  });
});
