import { describe, expect, it } from "vitest";
import { llmsTxt } from "./llms-txt";
import { ALLOCATE_PLAN_PRICE_USD } from "./v1-allocate-plan";
import { POSITION_PRICE_USD } from "./v1-position";

describe("llmsTxt", () => {
  const t = llmsTxt("https://aeroallocator.app");
  it("lists the paid endpoints with the prices the routes actually charge", () => {
    expect(t).toContain(`https://aeroallocator.app/api/v1/position?tokenId=<id> or ?address=0x… ($${POSITION_PRICE_USD.toFixed(2)})`);
    expect(t).toContain(`https://aeroallocator.app/api/v1/allocate-plan?tokenId=<id>&maxGauges=<1-6> ($${ALLOCATE_PLAN_PRICE_USD.toFixed(2)})`);
  });
  it("points to the OpenAPI spec and the two skills, and lists the token-prices read", () => {
    expect(t).toContain("https://aeroallocator.app/openapi.json");
    expect(t).toMatch(/saero-allocator-automator/);
    expect(t).toMatch(/veaero-to-saero-upgrade/);
    expect(t).toMatch(/\/api\/token-prices/);
    expect(t).toMatch(/cooldownSec/);
  });
  it("says what is free, that rejected calls are not charged, and that nothing is signed", () => {
    expect(t).toMatch(/\/api\/gauges\?chain=8453/);
    expect(t).toMatch(/never charged/);
    expect(t).toMatch(/never hold keys, sign or send/);
  });
  it("gives the npx line for the MCP package, before the paid section", () => {
    expect(t).toContain('"args": ["-y", "aeroallocator-mcp"]');
    expect(t.indexOf("aeroallocator-mcp")).toBeLessThan(t.indexOf("## Paid"));
  });
});
