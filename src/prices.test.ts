import { describe, expect, it } from "vitest";
import { sumRewardsUsd, type TokenPrice } from "./prices.js";

const USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const AERO = "0x940181a94a35a4569e4529a3cdfb74e38fd98631";

describe("sumRewardsUsd", () => {
  it("sums priced rewards, decimal-adjusted", () => {
    const prices = new Map<string, TokenPrice | null>([
      [USDC, { priceUsd: 1, decimals: 6, symbol: "USDC" }],
      [AERO, { priceUsd: 0.5, decimals: 18, symbol: "AERO" }],
    ]);
    const total = sumRewardsUsd(
      [
        { token: USDC, amount: 100_000_000n }, // 100 USDC
        { token: AERO, amount: 10n * 10n ** 18n }, // 10 AERO
      ],
      prices,
    );
    expect(total).toBeCloseTo(100 + 5, 6);
  });

  it("treats unpriced tokens as zero instead of throwing", () => {
    const prices = new Map<string, TokenPrice | null>([[USDC, null]]);
    const total = sumRewardsUsd([{ token: USDC, amount: 100_000_000n }], prices);
    expect(total).toBe(0);
  });

  it("looks up tokens case-insensitively", () => {
    const prices = new Map<string, TokenPrice | null>([[USDC, { priceUsd: 1, decimals: 6, symbol: "USDC" }]]);
    const total = sumRewardsUsd([{ token: USDC.toUpperCase(), amount: 1_000_000n }], prices);
    expect(total).toBeCloseTo(1, 6);
  });

  it("returns 0 for an empty reward list", () => {
    expect(sumRewardsUsd([], new Map())).toBe(0);
  });
});
