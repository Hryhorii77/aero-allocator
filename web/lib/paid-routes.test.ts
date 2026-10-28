// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

// Every paid route's own payment configuration, captured as the route files build it.
const configs = vi.hoisted(() => [] as Array<{ path: string; description: string; tags?: string[]; priceUsd: number; discovery: Record<string, unknown> }>);
vi.mock("@/lib/x402", async (orig) => ({
  ...(await orig<typeof import("@/lib/x402")>()),
  paidRoute: (config: (typeof configs)[number], handler: unknown) => {
    configs.push(config);
    return handler;
  },
}));

const load = async () => {
  await import("@/app/api/v1/position/route");
  await import("@/app/api/v1/allocate-plan/route");
  await import("@/app/api/v1/cross-chain-plan/route");
  return configs;
};

describe("paid routes' payment configuration", () => {
  it("keeps each resource description within what Coinbase's facilitator accepts", async () => {
    // A payment echoes the challenge's resource; the facilitator rejected the whole payload as invalid when the description was 581 characters
    // (500 passed its schema check, 520 did not), which made the first paid cross-chain call fail with a 402 after signing.
    const all = await load();
    expect(all.map((c) => c.path).sort()).toEqual(["/api/v1/allocate-plan", "/api/v1/cross-chain-plan", "/api/v1/position"]);
    for (const c of all) expect(c.description.length, c.path).toBeLessThanOrEqual(500);
  });

  it("declares valid Bazaar discovery metadata for each route", async () => {
    const { declareDiscoveryExtension, validateBazaarRouteExtensions } = await import("@x402/extensions/bazaar");
    for (const c of await load()) {
      const routes = { [c.path]: { extensions: { ...declareDiscoveryExtension(c.discovery as never) } } } as never;
      expect(() => validateBazaarRouteExtensions(routes), c.path).not.toThrow();
    }
  });
});
