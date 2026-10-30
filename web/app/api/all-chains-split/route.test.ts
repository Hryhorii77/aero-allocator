import { describe, expect, it, vi } from "vitest";

const read = vi.hoisted(() => vi.fn());
vi.mock("@/lib/all-chains-read", () => ({ readAllChainsSplit: read }));

import { GET } from "./route";

const call = (qs: string, ip = "9.9.9.1") => GET(new Request(`http://x/api/all-chains-split?${qs}`, { headers: { "x-forwarded-for": ip } }));

describe("GET /api/all-chains-split", () => {
  it("rejects a missing, zero, negative or absurd amount and a bad horizon before reading anything", async () => {
    for (const qs of ["", "amount=0", "amount=-5", "amount=abc", "amount=2000000000", "amount=100&days=0", "amount=100&days=91", "amount=100&days=x"]) {
      expect((await call(qs, "9.9.9.2")).status, qs).toBe(400);
    }
    expect(read).not.toHaveBeenCalled();
  });

  it("passes a valid amount and horizon through and returns the answer", async () => {
    read.mockResolvedValue({ amount: 100, days: 30 });
    const res = await call("amount=100&days=30", "9.9.9.3");
    expect(res.status).toBe(200);
    expect(read).toHaveBeenCalledWith(100, 30);
    expect(await res.json()).toEqual({ amount: 100, days: 30 });
  });

  it("works the answer out for the amount to three figures, so an exact amount and the page's rounded one agree", async () => {
    read.mockResolvedValue({ amount: 12300, days: 30 });
    await call("amount=12345&days=30", "9.9.9.5");
    expect(read).toHaveBeenLastCalledWith(12300, 30);
  });

  it("is a 503 when nothing can be ranked", async () => {
    read.mockResolvedValue(null);
    expect((await call("amount=100", "9.9.9.4")).status).toBe(503);
  });
});
