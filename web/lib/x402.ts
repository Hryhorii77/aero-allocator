import { HTTPFacilitatorClient } from "@x402/core/server";
import { x402ResourceServer } from "@x402/next";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { facilitator as cdpFacilitatorConfig } from "@coinbase/x402";

// Base mainnet, CAIP-2 format (eip155:<chainId>).
export const BASE_MAINNET_CAIP2 = "eip155:8453";

// Coinbase's CDP facilitator does mainnet USDC verification/settlement on
// Base — reads CDP_API_KEY_ID / CDP_API_KEY_SECRET from the environment
// lazily (only when actually verifying/settling a payment), so this is
// safe to construct even where those aren't set (CI, local dev, an
// unconfigured preview deploy) — see app/api/v1/forecast for the
// payTo-address gate that actually decides whether a route accepts
// payment.
const facilitatorClient = new HTTPFacilitatorClient(cdpFacilitatorConfig);

export const x402Server = new x402ResourceServer(facilitatorClient).register(
  BASE_MAINNET_CAIP2,
  new ExactEvmScheme(),
);
