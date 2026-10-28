// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import type { FacilitatorClient } from "@x402/core/server";

// Capture the route's own payment configuration and run it through the real x402 flow with a stub facilitator: the route file
// builds its wrapper at import time with the real facilitator, so the test reuses its config and handler instead.
const captured = vi.hoisted(() => ({ config: null as null | Record<string, unknown> }));
vi.mock("@/lib/x402", async (orig) => ({
  ...(await orig<typeof import("@/lib/x402")>()),
  paidRoute: (config: Record<string, unknown>, handler: unknown) => {
    captured.config = config;
    return handler;
  },
}));
vi.mock("@/lib/v1-cross-chain-plan", async (orig) => ({ ...(await orig<typeof import("@/lib/v1-cross-chain-plan")>()), handleCrossChainPlan: async () => NextResponse.json({ ok: true }) }));


const PAY_TO = "0x1111111111111111111111111111111111111111";
const ENV = { X402_PAYTO_ADDRESS: PAY_TO, CDP_API_KEY_ID: "id", CDP_API_KEY_SECRET: "secret" };
const decode = (h: string | null) => JSON.parse(Buffer.from(h ?? "", "base64").toString("utf8"));

describe("/api/v1/cross-chain-plan payment flow", () => {
  it("challenges, verifies and settles a request whose query has colons and commas, and lists the route's own discovery metadata", async () => {
    await import("./route");
    const { BASE_MAINNET_CAIP2, makeX402Server, paidRoute } = await vi.importActual<typeof import("@/lib/x402")>("@/lib/x402");
    const config = captured.config as unknown as Parameters<typeof paidRoute>[0];
    expect(config.path).toBe("/api/v1/cross-chain-plan");
    const verify = vi.fn(async () => ({ isValid: true, payer: "0x2222222222222222222222222222222222222222" }));
    const settle = vi.fn(async () => ({ success: true, transaction: "0xabc", network: BASE_MAINNET_CAIP2, payer: "0x2222222222222222222222222222222222222222" }));
    const facilitator = { verify, settle, getSupported: async () => ({ kinds: [{ x402Version: 2, scheme: "exact", network: BASE_MAINNET_CAIP2 }], extensions: ["bazaar"], signers: {} }) } as unknown as FacilitatorClient;
    const wrapped = paidRoute(config, async () => NextResponse.json({ ok: true }), { env: ENV, server: makeX402Server(facilitator as never) });
    const url = "http://localhost/api/v1/cross-chain-plan?tokenId=15308&chains=5042:30,10:20";
    const unpaid = await wrapped(new NextRequest(url));
    expect(unpaid.status).toBe(402);
    const challenge = decode(unpaid.headers.get("PAYMENT-REQUIRED"));
    expect(challenge.accepts[0]).toMatchObject({ amount: "250000", payTo: PAY_TO });
    expect(challenge.extensions.bazaar.info.input.queryParams).toMatchObject({ tokenId: "15308", chains: "5042:30,10:20" });
    const payment = Buffer.from(JSON.stringify({ x402Version: 2, resource: challenge.resource, accepted: challenge.accepts[0], payload: { signature: "0xsig", authorization: {} }, extensions: challenge.extensions })).toString("base64");
    const paid = await wrapped(new NextRequest(url, { headers: { "PAYMENT-SIGNATURE": payment } }));
    expect(paid.status).toBe(200);
    expect(verify).toHaveBeenCalledTimes(1);
    expect(settle).toHaveBeenCalledTimes(1);
  });
});
