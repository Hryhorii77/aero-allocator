import { NextRequest, NextResponse } from "next/server";
import { withX402 } from "@x402/next";
import { getAddress, isAddress } from "viem";
import { calibratedSnapshot } from "@/lib/snapshot";
import { x402Server, BASE_MAINNET_CAIP2 } from "@/lib/x402";
import { minimumBribeForTarget } from "aero-allocator/bribe-target";
import { PRESET } from "aero-allocator/config";
import { withApiErrorHandling } from "@/lib/api-error";
import { logX402Usage } from "@/lib/x402-usage";

// Same 60s ceiling as the other snapshot-backed routes.
export const maxDuration = 60;

const PRICE_USD = 0.1;

/**
 * For a protocol or team paying bribes into a gauge: what's the least it
 * would take to move this pool to a target share of all votes?
 *
 * Priced above /position because the buyer is different — a protocol
 * budgeting a bribe, not a voter checking a split — and the answer is worth
 * more to them than the price of a call. Paid-only, like /position: the
 * free dashboard's bribe simulator already answers "what does $X buy";
 * this is the same model run the other way, and the answer an agent or
 * treasury can act on without a human reading a chart.
 *
 * The number is a FLOOR, and the payload says so (`basis`): it inverts a
 * simulator that documents itself as a theoretical ceiling on vote pull.
 */
const handler = withApiErrorHandling<NextRequest>("v1/bribe-target", async (req) => {
  const q = req.nextUrl.searchParams;
  const rawPool = q.get("pool");
  const target = Number(q.get("targetSharePct"));

  // 400 (not 402-then-fail): withX402 cancels settlement when the handler
  // returns >= 400, so a typo costs the caller nothing — and is caught before
  // any snapshot work.
  if (!rawPool || !isAddress(rawPool)) {
    return NextResponse.json({ error: "Pass ?pool=0x… — the pool (not gauge) address." }, { status: 400 });
  }
  if (!(target > 0 && target <= 100)) {
    return NextResponse.json(
      { error: "Pass ?targetSharePct=<number above 0, at most 100> — the share of all votes to reach." },
      { status: 400 },
    );
  }
  const pool = getAddress(rawPool);

  const snap = await calibratedSnapshot(false);
  let result;
  try {
    result = minimumBribeForTarget(snap, pool, target);
  } catch (e) {
    // The simulator throws for a pool that isn't an eligible, gauge-alive
    // pool in this snapshot. That's "not found" (uncharged), not a crash.
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 404 });
  }

  logX402Usage({ route: "v1/bribe-target", priceUsd: PRICE_USD, refresh: false, params: { pool, targetSharePct: target } });

  return NextResponse.json({ generatedAt: new Date(snap.generatedAt).toISOString(), ...result });
});

// Same graceful-degradation gate as the other paid routes: a deployment
// without the payment config serves a clear 501 rather than routing payments
// to a placeholder or crashing inside the facilitator's initialize().
const payToEnv = process.env.X402_PAYTO_ADDRESS;
let payToAddress: `0x${string}` | null = null;
if (payToEnv) {
  try {
    payToAddress = getAddress(payToEnv);
  } catch (e) {
    console.error(
      JSON.stringify({
        level: "error",
        route: "v1/bribe-target",
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
          price: `$${PRICE_USD}`,
          network: BASE_MAINNET_CAIP2,
          payTo: payToAddress!,
        },
        description:
          `The least bribe that could move a pool on ${PRESET.displayName} to a target share of all votes: pass ` +
          "?pool=0x…&targetSharePct=N, get a model FLOOR (the bribe simulator run backwards — real voters move " +
          "slower, so budget above it), the cost curve to get there, and what's already posted on the pool.",
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
