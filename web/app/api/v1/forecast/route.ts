import { NextRequest, NextResponse } from "next/server";
import { withX402 } from "@x402/next";
import { getAddress } from "viem";
import { buildFullForecast } from "@/lib/snapshot";
import { x402Server, BASE_MAINNET_CAIP2 } from "@/lib/x402";

// Same 60s ceiling as api/dashboard — this hits the same snapshot build.
export const maxDuration = 60;

const handler = async (req: NextRequest) => {
  const params = req.nextUrl.searchParams;
  const refresh = params.get("refresh") === "1";
  const votingPower = Math.max(1, Number(params.get("votingPower") ?? 10000) || 10000);
  return NextResponse.json(await buildFullForecast(votingPower, refresh));
};

// Paid mirror of api/dashboard, for agents/treasuries that want programmatic
// access to the forecast without self-hosting the MCP server + their own
// RPC. The free dashboard and MCP server are unaffected by this — same
// engine, same data, just a second way to get at it. x402 handles payment:
// a request without a valid X-PAYMENT header gets a 402 with the price;
// with one, the facilitator verifies it before this handler runs, and
// settles on-chain only after a successful (< 400) response.
//
// Config is read here (not baked into the withX402 setup at module scope
// unconditionally) so a deployment missing any of it — CI, local dev, an
// unconfigured preview — still builds and typechecks; it just serves a
// clear 501 instead of either risking payments routed to a placeholder
// address or crashing with a raw 500 (the facilitator's own initialize()
// call fails hard, with no built-in fallback, if CDP_API_KEY_ID/SECRET
// aren't valid — confirmed by testing without them).
const payToEnv = process.env.X402_PAYTO_ADDRESS;
const x402Configured = !!payToEnv && !!process.env.CDP_API_KEY_ID && !!process.env.CDP_API_KEY_SECRET;

export const GET = x402Configured
  ? withX402(
      handler,
      {
        accepts: {
          scheme: "exact",
          price: "$0.05",
          network: BASE_MAINNET_CAIP2,
          // Non-null: x402Configured already checked payToEnv is set.
          payTo: getAddress(payToEnv!),
        },
        description:
          "Full Aerodrome forecast: predicted hot pools, three allocation objectives (protocol_efficiency, " +
          "voter_roi, edge_hunter), LP staking yield, and vote-swing signals — same data as the free " +
          "dashboard, for programmatic access without self-hosting.",
      },
      x402Server,
    )
  : async () =>
      NextResponse.json(
        {
          error:
            "This endpoint isn't configured on this deployment (needs X402_PAYTO_ADDRESS and " +
            "CDP_API_KEY_ID/CDP_API_KEY_SECRET); it's disabled until then.",
        },
        { status: 501 },
      );
