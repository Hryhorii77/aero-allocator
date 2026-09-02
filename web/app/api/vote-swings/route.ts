import { NextResponse } from "next/server";
import { getMarketSnapshot, detectVoteSwings } from "aero-allocator/scoring";
import { withApiErrorHandling } from "@/lib/api-error";

export const GET = withApiErrorHandling("vote-swings", async (req: Request) => {
  const params = new URL(req.url).searchParams;
  const maxPools = Math.min(30, Math.max(1, Number(params.get("maxPools") ?? 8) || 8));

  const snap = await getMarketSnapshot();
  return NextResponse.json(detectVoteSwings(snap, { maxPools }));
});
