import { NextResponse, type NextRequest } from "next/server";
import { getAddress } from "viem";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { withX402, x402ResourceServer } from "@x402/next";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { facilitator as cdpFacilitatorConfig } from "@coinbase/x402";
import { bazaarResourceServerExtension, declareDiscoveryExtension } from "@x402/extensions/bazaar";

/** Base mainnet in CAIP-2 form: payments are USDC on Base. */
export const BASE_MAINNET_CAIP2 = "eip155:8453";

// Coinbase's CDP facilitator verifies and settles the USDC payment. It reads CDP_API_KEY_ID / CDP_API_KEY_SECRET lazily, only when
// a payment is actually checked, so building this is safe where they aren't set (CI, local dev, an unconfigured preview).
// The Bazaar extension is what lets Coinbase's catalog (and agentic.market) index each route after its first settled payment.
/** The resource server a route is wrapped with; tests pass one backed by a stub facilitator. */
export const makeX402Server = (facilitator = new HTTPFacilitatorClient(cdpFacilitatorConfig)) =>
  new x402ResourceServer(facilitator).register(BASE_MAINNET_CAIP2, new ExactEvmScheme()).registerExtension(bazaarResourceServerExtension);
const x402Server = makeX402Server();

export type X402Status = { configured: true; payTo: `0x${string}` } | { configured: false; reason: string };

/** Paid routes are live only with a valid payout address and both CDP keys; otherwise they answer 501 instead of taking payment. */
export function x402Status(env: Record<string, string | undefined> = process.env): X402Status {
  const raw = env.X402_PAYTO_ADDRESS;
  if (!raw) return { configured: false, reason: "X402_PAYTO_ADDRESS is not set" };
  let payTo: `0x${string}`;
  try {
    payTo = getAddress(raw);
  } catch {
    return { configured: false, reason: "X402_PAYTO_ADDRESS is not a valid address" };
  }
  if (!env.CDP_API_KEY_ID || !env.CDP_API_KEY_SECRET) return { configured: false, reason: "CDP_API_KEY_ID / CDP_API_KEY_SECRET are not set" };
  return { configured: true, payTo };
}

export interface PaidRoute {
  /** The route's own path, exactly as served: it is the key Bazaar indexes the resource under. */
  path: string;
  priceUsd: number;
  description: string;
  /** Input and output examples/schemas so an agent can build a valid call before paying. */
  discovery: Parameters<typeof declareDiscoveryExtension>[0];
  tags?: string[];
}

/**
 * Wraps a handler so it needs an x402 payment. Settlement happens only after the handler returns a status below 400, so a bad request,
 * a not-found or a failed read never costs the caller anything. Without payment config the route serves a plain 501.
 */
export function paidRoute(
  route: PaidRoute,
  handler: (req: NextRequest) => Promise<NextResponse>,
  opts: { env?: Record<string, string | undefined>; server?: x402ResourceServer } = {},
) {
  const status = x402Status(opts.env ?? process.env);
  if (!status.configured) {
    return async () => NextResponse.json({ error: `This endpoint is not configured on this deployment (${status.reason}).` }, { status: 501 });
  }
  return withX402(
    handler,
    {
      [route.path]: {
        accepts: { scheme: "exact", price: `$${route.priceUsd}`, network: BASE_MAINNET_CAIP2, payTo: status.payTo },
        description: route.description,
        mimeType: "application/json",
        serviceName: "Aero Allocator",
        tags: route.tags ?? ["aero", "aerodrome", "saero", "defi", "base"],
        extensions: { ...declareDiscoveryExtension(route.discovery) },
      },
    },
    opts.server ?? x402Server,
  );
}
