import { describe, expect, it } from "vitest";
import { GET } from "./route";
import { PRESET, PROTOCOL } from "aero-allocator/config";

describe("GET /api/protocol", () => {
  it("returns the server-side PRESET's protocol and contract addresses", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      protocol: PROTOCOL,
      voterAddress: PRESET.addresses.voter,
      veSugarAddress: PRESET.addresses.veSugar,
    });
  });
});
