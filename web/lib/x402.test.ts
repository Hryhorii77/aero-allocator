// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import type { FacilitatorClient } from "@x402/core/server";
import { BASE_MAINNET_CAIP2, makeX402Server, paidRoute, x402Status } from "./x402";

const PAY_TO = "0x1111111111111111111111111111111111111111";
const FULL_ENV = { X402_PAYTO_ADDRESS: PAY_TO, CDP_API_KEY_ID: "id", CDP_API_KEY_SECRET: "secret" };

describe("x402Status", () => {
  it("is configured only with a valid payout address and both CDP keys", () => {
    expect(x402Status(FULL_ENV)).toEqual({ configured: true, payTo: PAY_TO });
    expect(x402Status({})).toMatchObject({ configured: false, reason: expect.stringMatching(/X402_PAYTO_ADDRESS is not set/) });
    expect(x402Status({ ...FULL_ENV, X402_PAYTO_ADDRESS: "nope" })).toMatchObject({ configured: false, reason: expect.stringMatching(/not a valid address/) });
    expect(x402Status({ ...FULL_ENV, CDP_API_KEY_SECRET: undefined })).toMatchObject({ configured: false, reason: expect.stringMatching(/CDP_API_KEY/) });
  });
});

const route = {
  path: "/api/v1/test",
  priceUsd: 0.05,
  description: "A test route",
  discovery: { input: { tokenId: "1" }, inputSchema: { properties: { tokenId: { type: "string" } }, required: ["tokenId"] }, output: { example: { ok: true } } },
};
const req = (headers: Record<string, string> = {}) => new NextRequest("http://localhost/api/v1/test?tokenId=1", { headers });

describe("paidRoute without payment config", () => {
  it("serves a plain 501 and never asks for payment", async () => {
    const handler = vi.fn(async () => NextResponse.json({ ok: true }));
    const res = await paidRoute(route, handler, { env: {} })(req());
    expect(res.status).toBe(501);
    expect((await res.json()).error).toMatch(/not configured/);
    expect(handler).not.toHaveBeenCalled();
  });
});

function stubFacilitator() {
  const verify = vi.fn(async () => ({ isValid: true, payer: "0x2222222222222222222222222222222222222222" }));
  const settle = vi.fn(async () => ({ success: true, transaction: "0xabc", network: BASE_MAINNET_CAIP2, payer: "0x2222222222222222222222222222222222222222" }));
  const facilitator = {
    verify,
    settle,
    getSupported: async () => ({ kinds: [{ x402Version: 2, scheme: "exact", network: BASE_MAINNET_CAIP2 }], extensions: ["bazaar"], signers: {} }),
  } as unknown as FacilitatorClient;
  return { facilitator, verify, settle };
}

const decode = (h: string | null) => JSON.parse(Buffer.from(h ?? "", "base64").toString("utf8"));

describe("paidRoute with payment config", () => {
  it("answers an unpaid request with 402, the price, our payout address and the Bazaar discovery metadata", async () => {
    const { facilitator } = stubFacilitator();
    const handler = vi.fn(async () => NextResponse.json({ ok: true }));
    const res = await paidRoute(route, handler, { env: FULL_ENV, server: makeX402Server(facilitator as never) })(req());
    expect(res.status).toBe(402);
    expect(handler).not.toHaveBeenCalled();
    const challenge = decode(res.headers.get("PAYMENT-REQUIRED"));
    const accepts = challenge.accepts[0];
    expect(accepts).toMatchObject({ scheme: "exact", network: BASE_MAINNET_CAIP2, payTo: PAY_TO, amount: "50000" });
    expect(challenge.resource.description).toBe("A test route");
    expect(challenge.extensions.bazaar.info.input.queryParams).toEqual({ tokenId: "1" });
    expect(challenge.extensions.bazaar.info.output.example).toEqual({ ok: true });
  });

  it("settles after a successful answer, and does not settle when the handler answers 400 or above", async () => {
    for (const [status, shouldSettle] of [[200, true], [400, false], [404, false]] as const) {
      const { facilitator, verify, settle } = stubFacilitator();
      const wrapped = paidRoute(route, async () => NextResponse.json({ s: status }, { status }), { env: FULL_ENV, server: makeX402Server(facilitator as never) });
      const challenge = decode((await wrapped(req())).headers.get("PAYMENT-REQUIRED"));
      const payment = Buffer.from(JSON.stringify({ x402Version: 2, resource: challenge.resource, accepted: challenge.accepts[0], payload: { signature: "0xsig", authorization: {} } })).toString("base64");
      const res = await wrapped(req({ "PAYMENT-SIGNATURE": payment }));
      expect(res.status).toBe(status);
      expect(verify).toHaveBeenCalledTimes(1);
      expect(settle).toHaveBeenCalledTimes(shouldSettle ? 1 : 0);
    }
  });
});

describe("paidRoute logs why a payment was refused", () => {
  it("writes the facilitator's reason when a request with a payment still gets a 402, and nothing for a plain unpaid request", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const verify = vi.fn(async () => ({ isValid: false, invalidReason: "insufficient_funds", payer: "0x2222222222222222222222222222222222222222" }));
    const facilitator = {
      verify,
      settle: vi.fn(),
      getSupported: async () => ({ kinds: [{ x402Version: 2, scheme: "exact", network: BASE_MAINNET_CAIP2 }], extensions: ["bazaar"], signers: {} }),
    } as unknown as FacilitatorClient;
    const wrapped = paidRoute(route, async () => NextResponse.json({ ok: true }), { env: FULL_ENV, server: makeX402Server(facilitator as never) });
    const unpaid = await wrapped(req());
    expect(unpaid.status).toBe(402);
    expect(spy).not.toHaveBeenCalled();
    const challenge = decode(unpaid.headers.get("PAYMENT-REQUIRED"));
    const payment = Buffer.from(JSON.stringify({ x402Version: 2, resource: challenge.resource, accepted: challenge.accepts[0], payload: { signature: "0xsig", authorization: {} } })).toString("base64");
    const rejected = await wrapped(req({ "PAYMENT-SIGNATURE": payment }));
    expect(rejected.status).toBe(402);
    expect(verify).toHaveBeenCalledTimes(1);
    const logged = spy.mock.calls.map((c) => String(c[0])).find((l) => l.includes("x402 payment rejected"));
    expect(logged).toBeDefined();
    expect(JSON.parse(logged!)).toMatchObject({ level: "error", route: "/api/v1/test", message: "x402 payment rejected" });
    expect(logged).toMatch(/insufficient_funds/);
    expect(logged).not.toContain("0xsig");
    spy.mockRestore();
  });
});
