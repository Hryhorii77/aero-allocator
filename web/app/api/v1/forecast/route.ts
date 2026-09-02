import { NextRequest, NextResponse } from "next/server";
import { withX402 } from "@x402/next";
import { getAddress } from "viem";
import { buildFullForecast } from "@/lib/snapshot";
import { x402Server, BASE_MAINNET_CAIP2 } from "@/lib/x402";
import { PRESET } from "aero-allocator/config";
import { withApiErrorHandling } from "@/lib/api-error";
import { logX402Usage } from "@/lib/x402-usage";

// Same 60s ceiling as api/dashboard — this hits the same snapshot build.
export const maxDuration = 60;

// withApiErrorHandling here (not just relying on withX402's own error path)
// matters more than elsewhere: this request already paid, so a thrown error
// after verification should log with full context — it's a real
// non-settlement (x402 only settles on <400) that's worth investigating,
// not silent.
const handler = withApiErrorHandling<NextRequest>("v1/forecast", async (req) => {
  const params = req.nextUrl.searchParams;
  const refresh = params.get("refresh") === "1";
  const votingPower = Math.max(1, Number(params.get("votingPower") ?? 10000) || 10000);
  const forecast = await buildFullForecast(votingPower, refresh);
  // Only after buildFullForecast succeeds — see logX402Usage's own comment
  // for why this stays in lockstep with what actually gets settled.
  logX402Usage({ refresh, votingPower });
  return NextResponse.json(forecast);
});

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
//
// getAddress() is wrapped in its own try/catch (not just relying on
// x402Configured's truthiness check) because it throws on anything that
// isn't a well-formed address — a truncated or typo'd X402_PAYTO_ADDRESS
// would otherwise crash this entire route (every request, paid or not)
// with a raw unhandled exception at module-evaluation time, defeating the
// graceful-501 degradation this whole block exists for.
const payToEnv = process.env.X402_PAYTO_ADDRESS;
let payToAddress: `0x${string}` | null = null;
if (payToEnv) {
  try {
    payToAddress = getAddress(payToEnv);
  } catch (e) {
    console.error(
      JSON.stringify({
        level: "error",
        route: "v1/forecast",
        message: `X402_PAYTO_ADDRESS is set but not a valid address: ${e instanceof Error ? e.message : String(e)}`,
      }),
    );
  }
}
const x402Configured = !!payToAddress && !!process.env.CDP_API_KEY_ID && !!process.env.CDP_API_KEY_SECRET;

export const GET = x402Configured
  ? withX402(
      handler,
      {
        accepts: {
          scheme: "exact",
          price: "$0.05",
          network: BASE_MAINNET_CAIP2,
          // Non-null: x402Configured already checked payToAddress is set.
          payTo: payToAddress!,
        },
        description:
          `Full ${PRESET.displayName} forecast: predicted hot pools, three allocation objectives ` +
          "(protocol_efficiency, voter_roi, edge_hunter), LP staking yield, and vote-swing signals — same " +
          "data as the free dashboard, for programmatic access without self-hosting.",
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
