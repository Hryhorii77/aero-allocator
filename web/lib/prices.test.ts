// @vitest-environment node
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { getPrices } from "./prices";

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

const CHAIN = "base";

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
