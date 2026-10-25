import { describe, expect, it } from "vitest";
import { feeBuckets, steadiness, steadyScore } from "./fee-history";

const T = "0x0000000000000000000000000000000000000001" as const;
const price = () => ({ priceUsd: 1, decimals: 6 });
const NOW = 1_000_000;
const SEC = 2;
const HEAD = 10_000_000n;
// An event `hoursAgo` before now.
const ev = (hoursAgo: number, usd: number) => ({ token: T, amount: BigInt(usd * 1e6), blockNumber: HEAD - BigInt(Math.round((hoursAgo * 3600) / SEC)) });

describe("feeBuckets", () => {
  it("sums later releases into complete stretches and drops the first release and the stretch in progress", () => {
    const events = [ev(50, 999), ev(30, 10), ev(20, 20), ev(7, 5), ev(1, 77)];
    const b = feeBuckets(events, HEAD, price, SEC, NOW, 12);
    // Stretches (oldest first) start after the first release at 50 h ago: [48-36], [36-24], [24-12], [12-0 in progress] -> 3 complete.
    expect(b.map((x) => x.usd)).toEqual([0, 10, 20]);
    expect(b[0].t).toBe(NOW - 48 * 3600);
  });
  it("has nothing to show with fewer than two releases", () => {
    expect(feeBuckets([ev(30, 5)], HEAD, price, SEC, NOW, 12)).toEqual([]);
    expect(feeBuckets([], HEAD, price, SEC, NOW, 12)).toEqual([]);
  });
  it("prices tokens it cannot price as zero rather than failing", () => {
    const b = feeBuckets([ev(40, 1), ev(30, 10), ev(20, 10)], HEAD, () => null, SEC, NOW, 12);
    expect(b.every((x) => x.usd === 0)).toBe(true);
  });
});

describe("steadiness", () => {
  const mk = (usds: number[]) => usds.map((usd, i) => ({ t: i, usd }));
  it("counts the stretches that paid at least half the average", () => {
    expect(steadiness(mk([10, 10, 10, 10]))).toEqual({ buckets: 4, paying: 4 });
    // mean 12.5: only 40 clears half of it
    expect(steadiness(mk([40, 5, 5, 0]))).toEqual({ buckets: 4, paying: 1 });
  });
  it("needs three stretches and some payout", () => {
    expect(steadiness(mk([10, 10]))).toBeNull();
    expect(steadiness(mk([0, 0, 0]))).toBeNull();
  });
  it("sorts a gauge with no figure last", () => {
    expect(steadyScore({ buckets: 4, paying: 3 })).toBe(0.75);
    expect(steadyScore(null)).toBe(-1);
  });
});
