import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { BASE_USDC, openApiSpec } from "./openapi";
import { ALLOCATE_PLAN_PRICE_USD } from "./v1-allocate-plan";
import { CROSS_CHAIN_PLAN_PRICE_USD } from "./v1-cross-chain-plan";
import { POSITION_PRICE_USD } from "./v1-position";

const PAY_TO = "0x9b3F205E43dc9FcC1cc2Fe6d9dCD0357769A6Bae";
type Op = { parameters?: Array<{ name: string; required?: boolean }>; responses: Record<string, unknown>; "x-payment-info"?: { priceUsd: number; amount: string; asset: string; payTo?: string } };
const spec = openApiSpec("https://aeroallocator.app", PAY_TO) as { openapi: string; paths: Record<string, { get: Op }>; components: { schemas: Record<string, unknown> } };

/** Every $ref in the document. */
function refs(x: unknown, out: string[] = []): string[] {
  if (Array.isArray(x)) x.forEach((v) => refs(v, out));
  else if (x && typeof x === "object") {
    for (const [k, v] of Object.entries(x)) {
      if (k === "$ref") out.push(String(v));
      else refs(v, out);
    }
  }
  return out;
}

describe("openApiSpec", () => {
  it("is OpenAPI 3.1 and every $ref points at a schema that exists", () => {
    expect(spec.openapi).toBe("3.1.0");
    const found = refs(spec);
    expect(found.length).toBeGreaterThan(10);
    for (const r of found) expect(spec.components.schemas[r.replace("#/components/schemas/", "")], r).toBeDefined();
  });

  it("describes only routes that exist in the app, each with a success response", () => {
    for (const [path, item] of Object.entries(spec.paths)) {
      expect(existsSync(join(__dirname, "..", "app", path.slice(1), "route.ts")), path).toBe(true);
      expect(item.get.responses["200"], path).toBeDefined();
    }
    expect(Object.keys(spec.paths)).toEqual(
      expect.arrayContaining(["/api/gauges", "/api/gauge-fees", "/api/gauge-history", "/api/gauge-flows", "/api/allocation-fee", "/api/token-prices", "/api/track-record", "/api/top-gauges", "/api/v1/position", "/api/v1/allocate-plan", "/api/v1/cross-chain-plan"]),
    );
  });

  it("ties the paid routes' prices to the route constants, in USDC on Base, and documents the 402 and the never-charged errors", () => {
    const pos = spec.paths["/api/v1/position"].get;
    const plan = spec.paths["/api/v1/allocate-plan"].get;
    expect(pos["x-payment-info"]).toMatchObject({ priceUsd: POSITION_PRICE_USD, amount: "50000", asset: BASE_USDC, payTo: PAY_TO });
    expect(plan["x-payment-info"]).toMatchObject({ priceUsd: ALLOCATE_PLAN_PRICE_USD, amount: "100000", asset: BASE_USDC });
    const cross = spec.paths["/api/v1/cross-chain-plan"].get;
    expect(cross["x-payment-info"]).toMatchObject({ priceUsd: CROSS_CHAIN_PLAN_PRICE_USD, amount: "250000", asset: BASE_USDC });
    for (const op of [pos, plan, cross]) expect(Object.keys(op.responses)).toEqual(expect.arrayContaining(["200", "400", "402", "404"]));
    expect(Object.keys(cross.responses)).toEqual(expect.arrayContaining(["422", "503"]));
    expect(Object.keys(plan.responses)).toContain("422");
  });

  it("marks the free reads as unpaid and requires the parameters the routes require", () => {
    for (const path of ["/api/gauges", "/api/gauge-fees", "/api/gauge-flows"]) {
      expect(spec.paths[path].get["x-payment-info"]).toBeUndefined();
      expect(spec.paths[path].get.parameters?.find((p) => p.name === "chain")?.required).toBe(true);
    }
    expect(spec.paths["/api/v1/allocate-plan"].get.parameters?.find((p) => p.name === "tokenId")?.required).toBe(true);
    expect(spec.paths["/api/v1/cross-chain-plan"].get.parameters?.find((p) => p.name === "tokenId")?.required).toBe(true);
    expect(spec.paths["/api/v1/cross-chain-plan"].get.parameters?.find((p) => p.name === "chains")?.required).toBe(false);
    expect(spec.paths["/api/v1/position"].get.parameters?.find((p) => p.name === "tokenId")?.required).toBe(false);
  });

  it("declares security on every operation: none for the free reads, the x402 payment header for the paid ones", () => {
    for (const [path, item] of Object.entries(spec.paths)) {
      const sec = (item.get as unknown as { security: unknown }).security;
      expect(sec, path).toEqual(path.startsWith("/api/v1/") ? [{ x402: [] }] : []);
    }
  });

  it("leaves the payout address out when none is configured", () => {
    const bare = openApiSpec("https://aeroallocator.app") as typeof spec;
    expect(bare.paths["/api/v1/position"].get["x-payment-info"]?.payTo).toBeUndefined();
  });
});
