// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

const prices = vi.hoisted(() => ({ getPrices: vi.fn() }));
vi.mock("@/lib/prices", () => ({ getPrices: prices.getPrices }));

import { GET } from "./route";

const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const OTHER = "0xB2000000000000000000008501b13360000cb2EC";
let n = 0;
const req = (q: string) => new Request(`http://localhost/api/token-prices${q}`, { headers: { "x-forwarded-for": `10.3.0.${++n}` } });

describe("GET /api/token-prices", () => {
  it("returns a USD price per priced token and leaves out the ones it can't price", async () => {
    prices.getPrices.mockResolvedValueOnce(new Map([[USDC.toLowerCase(), { priceUsd: 1, decimals: 6 }], [OTHER.toLowerCase(), null]]));
    const res = await GET(req(`?tokens=${USDC},${OTHER},${USDC}`));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ prices: { [USDC.toLowerCase()]: 1 } });
    expect(prices.getPrices).toHaveBeenCalledWith([USDC.toLowerCase(), OTHER.toLowerCase()]);
    expect(res.headers.get("cache-control")).toMatch(/s-maxage=120/);
  });
  it("rejects missing, malformed or too many tokens before pricing anything", async () => {
    prices.getPrices.mockClear();
    expect((await GET(req(""))).status).toBe(400);
    expect((await GET(req("?tokens=nope"))).status).toBe(400);
    const many = Array.from({ length: 13 }, (_, i) => `0x${String(i + 1).padStart(40, "0")}`).join(",");
    expect((await GET(req(`?tokens=${many}`))).status).toBe(400);
    expect(prices.getPrices).not.toHaveBeenCalled();
  });
  it("answers with no prices rather than an error when the price source is down", async () => {
    prices.getPrices.mockRejectedValueOnce(new Error("llama down"));
    const res = await GET(req(`?tokens=${USDC}`));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ prices: {} });
  });
});
