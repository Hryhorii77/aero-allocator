import { afterEach, describe, expect, it, vi } from "vitest";
import { getChainPrices } from "./chain-prices";

const T1 = "0x00000000000000000000000000000000000000a1" as const;
const T2 = "0x00000000000000000000000000000000000000a2" as const;

afterEach(() => vi.unstubAllGlobals());

describe("getChainPrices", () => {
  it("prefixes the chain slug, reads price and decimals, and leaves unknown tokens null", async () => {
    const f = vi.fn(async (_url: string) => ({ ok: true, json: async () => ({ coins: { [`zzchain:${T1}`]: { price: 2.5, decimals: 6 } } }) }));
    vi.stubGlobal("fetch", f);
    const out = await getChainPrices("zzchain", [T1, T2]);
    expect(String(f.mock.calls[0][0])).toContain(`zzchain:${T1}`);
    expect(out.get(T1)).toEqual({ priceUsd: 2.5, decimals: 6 });
    expect(out.get(T2)).toBeNull();
  });
  it("returns nothing for a token (not an error) when the API fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 500 })));
    const out = await getChainPrices("yychain", ["0x00000000000000000000000000000000000000b1"]);
    expect(out.size).toBe(0);
  });
});
