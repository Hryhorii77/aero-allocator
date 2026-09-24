import { NextRequest, NextResponse } from "next/server";
import { withX402 } from "@x402/next";
import { getAddress, isAddress } from "viem";
import { calibratedSnapshot } from "@/lib/snapshot";
import { x402Server, BASE_MAINNET_CAIP2 } from "@/lib/x402";
import { recommendAllocation } from "aero-allocator/scoring";
import { blendVotes, computePositionDelta, type PoolRate } from "aero-allocator/position";
import { fetchAccountLocks } from "aero-allocator/lockers";
import { PRESET } from "aero-allocator/config";
import { withApiErrorHandling } from "@/lib/api-error";
import { logX402Usage } from "@/lib/x402-usage";

// Same 60s ceiling as the other snapshot-backed routes.
export const maxDuration = 60;

// Matches the dashboard's own voter_roi call (lib/snapshot.ts) so a caller
// is priced against the split the site would actually show them.
const MAX_POOLS = 8;

const PRICE_USD = 0.05;

/**
 * What a specific wallet's current vote is worth versus the recommended
 * split — per address, in dollars.
 *
 * This exists because /api/v1/forecast did not: it served the identical
 * payload as the free /api/dashboard (same buildFullForecast call, same
 * args), so there was no reason for anyone to pay for it, and it earned
 * essentially nothing. A paid endpoint has to answer something the free one
 * structurally cannot. The free route publishes the map; this one reads a
 * caller's own on-chain position off it and tells them where they're
 * standing — which requires a chain read keyed to their address, and is the
 * kind of answer an agent can act on without a human in the loop.
 */
const handler = withApiErrorHandling<NextRequest>("v1/position", async (req) => {
  const raw = req.nextUrl.searchParams.get("address");
  if (!raw || !isAddress(raw)) {
    // 400 (not 402-then-fail): withX402 cancels settlement when the wrapped
    // handler returns >= 400, so a malformed address costs the caller
    // nothing. Validating here rather than after the chain read keeps that
    // true for the cheap failure case.
    return NextResponse.json(
      { error: "Pass ?address=0x… — a wallet holding one or more veNFTs." },
      { status: 400 },
    );
  }
  const address = getAddress(raw);

  const [snap, locks] = await Promise.all([calibratedSnapshot(false), fetchAccountLocks(address)]);

  if (locks.length === 0) {
    return NextResponse.json(
      { error: `No ${PRESET.veTokenSymbol} locks with voting power found for ${address}.` },
      { status: 404 },
    );
  }

  // One portfolio-wide split across every lock this wallet holds, then the
  // recommendation sized for that combined power — dilution is size-
  // dependent, so a blended 2M position must not be priced against a
  // 10,000-ve default split.
  const { votingPower, votes } = blendVotes(locks);
  const rec = recommendAllocation(snap, "voter_roi", MAX_POOLS, votingPower);

  const poolRates = new Map<string, PoolRate>(
    snap.forecasts.map((f) => [
      f.pool.lp.toLowerCase(),
      { symbol: f.pool.symbol, rewardPer1kVotesUsd: f.rewardPer1kVotesUsd },
    ]),
  );

  const delta = computePositionDelta({ currentVotes: votes, votingPower, recommended: rec.allocations, poolRates });

  logX402Usage({ route: "v1/position", priceUsd: PRICE_USD, votingPower, refresh: false });

  return NextResponse.json({
    address,
    generatedAt: new Date().toISOString(),
    locks: locks.map((l) => ({
      tokenId: l.tokenId,
      votingPower: l.votingPower,
      permanent: l.permanent,
      expiresAt: l.expiresAt,
      hasVoted: l.votes.length > 0,
    })),
    votingPower,
    hasVoted: delta.hasVoted,
    current: votes,
    recommended: rec.allocations.map((a) => ({
      pool: a.pool,
      symbol: a.symbol,
      weightPct: a.weightPct,
      expectedRewardUsd: a.expectedRewardUsd,
    })),
    rows: delta.rows,
    estimateIfStayUsd: delta.estimateIfStayUsd,
    estimateIfSwitchUsd: delta.estimateIfSwitchUsd,
    deltaUsd: delta.deltaUsd,
    // A caller acting on this automatically needs to know when the two sides
    // aren't comparable — not to have the discrepancy hidden inside a number
    // that looks authoritative. When false, deltaUsd overstates the gain from
    // switching by however much the unpriced pools were worth.
    comparable: delta.comparable,
    unpricedPools: delta.unpricedPools,
    basis:
      "estimateIfStayUsd uses each held pool's last-epoch $/1k rate; estimateIfSwitchUsd uses this " +
      "forecast's next-epoch model after dilution. Different bases — treat the delta as directional.",
    summary: rec.summary,
  });
});

// Same graceful-degradation gate as v1/forecast: a deployment without the
// payment config (CI, local dev, an unconfigured preview) serves a clear 501
// rather than routing payments to a placeholder or crashing inside the
// facilitator's initialize().
const payToEnv = process.env.X402_PAYTO_ADDRESS;
let payToAddress: `0x${string}` | null = null;
if (payToEnv) {
  try {
    payToAddress = getAddress(payToEnv);
  } catch (e) {
    console.error(
      JSON.stringify({
        level: "error",
        route: "v1/position",
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
          `What a specific wallet's current ${PRESET.veTokenSymbol} vote is worth versus the recommended ` +
          "split: pass ?address=0x…, get its on-chain vote split, the dilution-sized recommendation for its " +
          "own voting power, and the dollar difference between staying and switching. Not available from the " +
          "free endpoints, which are address-agnostic.",
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
