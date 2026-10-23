import { describe, expect, it } from "vitest";
import { appendEvents, coverageHours, eventsWithin, MAX_LOOKBACK_BLOCKS, planRange, type Ledger } from "./fee-ledger";

const R = "0xAbC0000000000000000000000000000000000001" as const;
const T = "0x4200000000000000000000000000000000000006" as const;
const ev = (b: number, a = 5n) => ({ rewards: R, token: T, amount: a, blockNumber: BigInt(b) });

describe("planRange", () => {
  it("starts a new record at the lookback floor", () => {
    expect(planRange(null, 100_000n)).toEqual({ from: 100_000n - MAX_LOOKBACK_BLOCKS, reset: true });
  });
  it("continues from the block after the last one read", () => {
    const l = { version: 1, coverageFrom: 1, lastBlock: 99_000, updatedAt: 0, events: [] } as Ledger;
    expect(planRange(l, 100_000n)).toEqual({ from: 99_001n, reset: false });
  });
  it("starts over when the gap is longer than a catch-up can reach", () => {
    const l = { version: 1, coverageFrom: 1, lastBlock: 50_000, updatedAt: 0, events: [] } as Ledger;
    expect(planRange(l, 100_000n).reset).toBe(true);
  });
});

describe("appendEvents", () => {
  const range = { from: 1000n, to: 2000n, reset: true };
  it("starts a record, lowercases the rewards address and advances lastBlock", () => {
    const l = appendEvents(null, [ev(1500)], range, 1);
    expect(l.coverageFrom).toBe(1000);
    expect(l.lastBlock).toBe(2000);
    expect(l.events).toEqual([{ r: R.toLowerCase(), t: T, a: "5", b: 1500 }]);
  });
  it("drops duplicates when the same range is read twice", () => {
    const a = appendEvents(null, [ev(1500)], range, 1);
    const b = appendEvents(a, [ev(1500), ev(2100)], { from: 2001n, to: 3000n, reset: false }, 2);
    expect(b.events).toHaveLength(2);
    expect(b.lastBlock).toBe(3000);
    expect(b.coverageFrom).toBe(1000);
  });
  it("forgets old history when it has to start over", () => {
    const a = appendEvents(null, [ev(1500)], range, 1);
    const b = appendEvents(a, [ev(90_000)], { from: 89_000n, to: 90_500n, reset: true }, 2);
    expect(b.events).toHaveLength(1);
    expect(b.coverageFrom).toBe(89_000);
  });
  it("drops events past retention and moves coverage up", () => {
    const a = appendEvents(null, [ev(1500)], range, 1);
    const b = appendEvents(a, [], { from: 2001n, to: BigInt(1500 + 4 * 43_200 + 10), reset: false }, 2);
    expect(b.events).toHaveLength(0);
    expect(b.coverageFrom).toBeGreaterThan(1000);
  });
});

describe("eventsWithin / coverageHours", () => {
  const l = appendEvents(null, [ev(1500), ev(60_000), { ...ev(61_000), rewards: "0x0000000000000000000000000000000000000002" as const }], { from: 1000n, to: 100_000n, reset: true }, 1);
  it("keeps one contract's events inside the pace window, case-insensitively", () => {
    expect(eventsWithin(l, R, 100_000n).map((e) => e.blockNumber)).toEqual([60_000n]);
    expect(eventsWithin(l, R, 200_000n).map((e) => e.blockNumber)).toEqual([]);
  });
  it("reports hours covered, capped at the pace window", () => {
    expect(coverageHours(l, 2000n)).toBeCloseTo(1000 / 1800);
    expect(coverageHours(l, 400_000n)).toBeCloseTo((2 * 43_200) / 1800);
  });
});

describe("block time", () => {
  it("retains by days of the chain's own block time (12 s blocks: 7,200 a day)", () => {
    const a = appendEvents(null, [ev(1500)], { from: 1000n, to: 2000n, reset: true }, 1, 12);
    // 4 days = 28,800 blocks of 12 s; 1500 is still inside at block 20,000 but gone by 30,000.
    expect(appendEvents(a, [], { from: 2001n, to: 20_000n, reset: false }, 2, 12).events).toHaveLength(1);
    expect(appendEvents(a, [], { from: 2001n, to: 30_500n, reset: false }, 2, 12).events).toHaveLength(0);
  });
  it("reports coverage hours with the chain's block time", () => {
    const l = appendEvents(null, [], { from: 1000n, to: 1300n, reset: true }, 1, 12);
    expect(coverageHours(l, 1300n, 2, 12)).toBeCloseTo((300 * 12) / 3600);
  });
});
