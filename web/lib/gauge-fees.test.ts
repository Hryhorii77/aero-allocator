import { describe, expect, it } from "vitest";
import { blockRanges, chunk, feePace, feesUsdPerDay, withRetry } from "./gauge-fees";

const price = (t: string) => (t === "0xweth" ? { priceUsd: 2000, decimals: 18 } : t === "0xusdc" ? { priceUsd: 1, decimals: 6 } : null);

describe("chunk / blockRanges", () => {
  it("splits lists into groups no larger than the size", () => {
    expect(chunk([1, 2, 3, 4, 5, 6, 7], 3)).toEqual([[1, 2, 3], [4, 5, 6], [7]]);
    expect(chunk([], 3)).toEqual([]);
  });
  it("covers a range exactly with no overlap", () => {
    expect(blockRanges(0n, 24n, 10n)).toEqual([[0n, 9n], [10n, 19n], [20n, 24n]]);
    expect(blockRanges(5n, 5n, 10n)).toEqual([[5n, 5n]]);
  });
});

describe("feesUsdPerDay", () => {
  it("adds released and pending fees and scales to a day", () => {
    const events = [{ token: "0xusdc" as const, amount: 3_000_000n }]; // $3
    const pending = [{ token: "0xweth" as const, amount: 5n * 10n ** 14n }]; // 0.0005 WETH = $1
    expect(feesUsdPerDay(events, pending, 43_200, price)).toBeCloseTo(8, 6); // $4 over half a day
  });
  it("ignores unpriced tokens and negative pending, and a zero window", () => {
    expect(feesUsdPerDay([{ token: "0xnone" as const, amount: 10n ** 30n }], [{ token: "0xusdc" as const, amount: -5n }], 100, price)).toBe(0);
    expect(feesUsdPerDay([{ token: "0xusdc" as const, amount: 1_000_000n }], [], 0, price)).toBe(0);
  });
});

describe("withRetry", () => {
  it("returns after a transient failure", async () => {
    let n = 0;
    const out = await withRetry(async () => {
      if (++n < 3) throw new Error("busy");
      return "ok";
    }, 4, 1);
    expect(out).toBe("ok");
    expect(n).toBe(3);
  });
  it("throws the last error once attempts run out", async () => {
    await expect(withRetry(async () => { throw new Error("down"); }, 2, 1)).rejects.toThrow("down");
  });
});

describe("feePace", () => {
  const usdc = (n: number, block: bigint) => ({ token: "0xusdc" as const, amount: BigInt(n) * 1_000_000n, blockNumber: block });
  it("drops the first release (unknown backlog) and rates the rest over the time since it", () => {
    // first release at block 1000 ($50,000 backlog), later $10 + $10; head at 1000 + 3600 blocks = 2 hours
    const out = feePace([usdc(50_000, 1000n), usdc(10, 2000n), usdc(10, 3000n)], [], 4600n, price)!;
    expect(out.windowSec).toBe(7200);
    expect(out.usdPerDay).toBeCloseTo(((20 / 7200) * 86400), 6); // $240/day, not the backlog
  });
  it("counts fees still pending on top of later releases", () => {
    const out = feePace([usdc(5, 1000n), usdc(10, 2000n)], [{ token: "0xusdc", amount: 5_000_000n }], 4600n, price)!;
    expect(out.usdPerDay).toBeCloseTo(((15 / 7200) * 86400), 6);
  });
  it("is unknown (null) with no release, only one release moment, or too short a stretch", () => {
    expect(feePace([], [], 5000n, price)).toBeNull();
    expect(feePace([usdc(10, 1000n), { ...usdc(10, 1000n), token: "0xweth" as const }], [], 5000n, price)).toBeNull();
    expect(feePace([usdc(10, 1000n), usdc(10, 1100n)], [], 1500n, price)).toBeNull(); // 500 blocks = 1000 s
  });

  it("converts blocks to time with the chain's block time", () => {
    const out = feePace([usdc(50_000, 1000n), usdc(10, 2000n)], [], 1000n + 600n, price, 12)!;
    expect(out.windowSec).toBe(600 * 12);
  });
});
