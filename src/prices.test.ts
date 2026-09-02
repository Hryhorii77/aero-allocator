import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { getPrices, sumRewardsUsd, type TokenPrice } from "./prices.js";

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

// getPrices' cache is module-level, so each test below uses its own unique
// address(es) — real DefiLlama coin addresses aren't needed, only
// uniqueness, since fetch is always mocked here.
let addrCounter = 0;
function freshAddress(): string {
  addrCounter++;
  return `0x${addrCounter.toString().padStart(40, "0")}`;
}

function llamaResponse(chain: string, addr: string, coin: { price: number; decimals?: number; symbol?: string } | null) {
  return {
    ok: true,
    json: async () => ({ coins: coin ? { [`${chain}:${addr}`]: coin } : {} }),
  } as Response;
}

const CHAIN = "base"; // default AERO_PROTOCOL resolves to "aerodrome" -> "base" in test env

describe("getPrices", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("fetches and returns a price on the happy path", async () => {
    const addr = freshAddress();
    vi.stubGlobal("fetch", vi.fn(async () => llamaResponse(CHAIN, addr, { price: 2.5, decimals: 18, symbol: "TOK" })));

    const result = await getPrices([addr]);

    expect(result.get(addr)).toEqual({ priceUsd: 2.5, decimals: 18, symbol: "TOK" });
  });

  it("caches within the TTL — a second call for the same address doesn't refetch", async () => {
    const addr = freshAddress();
    const fetchMock = vi.fn(async () => llamaResponse(CHAIN, addr, { price: 1, decimals: 18, symbol: "TOK" }));
    vi.stubGlobal("fetch", fetchMock);

    await getPrices([addr]);
    await getPrices([addr]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries a transient failure and succeeds without ever throwing", async () => {
    const addr = freshAddress();
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        calls++;
        if (calls < 2) throw new Error("network blip");
        return llamaResponse(CHAIN, addr, { price: 3, decimals: 18, symbol: "TOK" });
      }),
    );

    const promise = getPrices([addr]);
    await vi.advanceTimersByTimeAsync(600); // clears the first backoff
    const result = await promise;

    expect(calls).toBe(2);
    expect(result.get(addr)).toEqual({ priceUsd: 3, decimals: 18, symbol: "TOK" });
  });

  it("never throws — falls back to null when DefiLlama is down and there's no cached price at all", async () => {
    const addr = freshAddress();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("DefiLlama is down");
      }),
    );
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const promise = getPrices([addr]);
    await vi.advanceTimersByTimeAsync(600);
    await vi.advanceTimersByTimeAsync(1100);
    const result = await promise;

    expect(result.get(addr)).toBeNull();
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("falls back to a stale cached price when a refetch fails but the cache entry is still recent", async () => {
    const addr = freshAddress();
    const fetchMock = vi
      .fn()
      // First call (populates the cache): succeeds.
      .mockImplementationOnce(async () => llamaResponse(CHAIN, addr, { price: 9, decimals: 18, symbol: "TOK" }))
      // Every retry attempt on the second call: fails.
      .mockImplementation(async () => {
        throw new Error("DefiLlama is down");
      });
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "error").mockImplementation(() => {});

    await getPrices([addr]);
    // Past the 5-minute price TTL, so a refetch is attempted — but still
    // well within the 1-hour stale-fallback ceiling.
    vi.setSystemTime(Date.now() + 6 * 60 * 1000);

    const promise = getPrices([addr]);
    await vi.advanceTimersByTimeAsync(600);
    await vi.advanceTimersByTimeAsync(1100);
    const result = await promise;

    expect(result.get(addr)).toEqual({ priceUsd: 9, decimals: 18, symbol: "TOK" });
  });

  it("does not use a stale price once it's older than the 1h fallback ceiling", async () => {
    const addr = freshAddress();
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(async () => llamaResponse(CHAIN, addr, { price: 9, decimals: 18, symbol: "TOK" }))
      .mockImplementation(async () => {
        throw new Error("DefiLlama is down");
      });
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "error").mockImplementation(() => {});

    await getPrices([addr]);
    vi.setSystemTime(Date.now() + 61 * 60 * 1000); // past the 1h ceiling

    const promise = getPrices([addr]);
    await vi.advanceTimersByTimeAsync(600);
    await vi.advanceTimersByTimeAsync(1100);
    const result = await promise;

    expect(result.get(addr)).toBeNull();
  });

  it("returns null (not a throw) for a token DefiLlama doesn't know about", async () => {
    const addr = freshAddress();
    vi.stubGlobal("fetch", vi.fn(async () => llamaResponse(CHAIN, addr, null)));

    const result = await getPrices([addr]);

    expect(result.get(addr)).toBeNull();
  });
});
