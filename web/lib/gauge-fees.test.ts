import { describe, expect, it, vi } from "vitest";
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

describe("readFeeEvents limits", () => {
  const addr = (n: number) => `0x${n.toString(16).padStart(40, "0")}` as `0x${string}`;
  const reader = () => {
    const calls: Array<{ n: number; span: bigint }> = [];
    return { calls, getLogs: async (a: { address: `0x${string}`[]; fromBlock: bigint; toBlock: bigint }) => (calls.push({ n: a.address.length, span: a.toBlock - a.fromBlock + 1n }), []) };
  };

  it("splits addresses and block ranges by the limits it is given", async () => {
    const { readFeeEvents } = await import("./gauge-fees");
    const r = reader();
    await readFeeEvents(r as never, Array.from({ length: 40 }, (_, i) => addr(i + 1)), 0n, 99_999n, 4, { span: 50_000, addresses: 20 });
    // 40 addresses / 20 = 2 batches, 100,000 blocks / 50,000 = 2 ranges
    expect(r.calls).toHaveLength(4);
    expect(Math.max(...r.calls.map((c) => c.n))).toBe(20);
    expect(Math.max(...r.calls.map((c) => Number(c.span)))).toBe(50_000);
  });

  it("keeps the old 5-address, 10,000-block defaults", async () => {
    const { readFeeEvents } = await import("./gauge-fees");
    const r = reader();
    await readFeeEvents(r as never, Array.from({ length: 11 }, (_, i) => addr(i + 1)), 0n, 19_999n);
    expect(r.calls).toHaveLength(6);
    expect(Math.max(...r.calls.map((c) => c.n))).toBe(5);
    expect(Math.max(...r.calls.map((c) => Number(c.span)))).toBe(10_000);
  });

  /** A node that refuses more than `maxSpan` blocks or `maxAddrs` addresses the way viem reports it, and logs one event per query. */
  const capped = (maxSpan: bigint, maxAddrs = 100, details = `block range is too large, max ${maxSpan}`) => {
    const calls: Array<{ n: number; span: bigint; ok: boolean }> = [];
    return {
      calls,
      getLogs: async (a: { address: `0x${string}`[]; fromBlock: bigint; toBlock: bigint }) => {
        const span = a.toBlock - a.fromBlock + 1n;
        const ok = span <= maxSpan && a.address.length <= maxAddrs;
        calls.push({ n: a.address.length, span, ok });
        if (!ok) throw Object.assign(new Error("RPC Request failed."), { shortMessage: "RPC Request failed.", details });
        return [{ address: a.address[0], blockNumber: a.fromBlock, args: { _gauge: a.address[0], _token: a.address[0], _amount: 1n } }];
      },
    };
  };

  it("halves a refused range, keeps the smaller span for the rest, and still covers every block", async () => {
    const { readFeeEvents } = await import("./gauge-fees");
    const r = capped(2_000n);
    const out = await readFeeEvents(r as never, [addr(1)], 0n, 89_999n, 1, { span: 45_000 });
    const good = r.calls.filter((c) => c.ok);
    expect(good.reduce((s, c) => s + c.span, 0n)).toBe(90_000n); // every block read once
    expect(out).toHaveLength(good.length);
    expect(r.calls.filter((c) => !c.ok).length).toBeLessThanOrEqual(6); // a few refusals, not one per query
  });

  it("halves the addresses when the range is already small", async () => {
    const { readFeeEvents } = await import("./gauge-fees");
    const r = capped(10_000n, 3, "A maximum of 3 addresses is allowed");
    await readFeeEvents(r as never, Array.from({ length: 10 }, (_, i) => addr(i + 1)), 0n, 999n, 1, { addresses: 10 });
    const good = r.calls.filter((c) => c.ok);
    expect(good.reduce((s, c) => s + c.n, 0)).toBe(10);
  });

  it("does not split on a rate limit or an outage: retries, then fails", async () => {
    const { readFeeEvents } = await import("./gauge-fees");
    vi.useFakeTimers();
    try {
      for (const details of ["request limit reached", "fetch failed"]) {
        const r = capped(0n, 100, details);
        const p = readFeeEvents(r as never, [addr(1)], 0n, 9_999n, 1).catch((e) => e);
        await vi.runAllTimersAsync();
        expect(await p).toBeInstanceOf(Error);
        expect(r.calls).toHaveLength(4); // the usual retries, all at the full span
        expect(new Set(r.calls.map((c) => c.span))).toEqual(new Set([10_000n]));
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it("treats 429 as a rate limit only as a whole number, not inside a block number", async () => {
    const { isTooBig } = await import("./gauge-fees");
    expect(isTooBig({ details: "block range is too large: 53429000-53474000" })).toBe(true);
    expect(isTooBig({ details: "HTTP 429 Too Many Requests" })).toBe(false);
  });
});
