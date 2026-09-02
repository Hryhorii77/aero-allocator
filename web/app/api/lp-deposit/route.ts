import { NextResponse } from "next/server";
import { getMarketSnapshot, recommendLpDeposits } from "aero-allocator/scoring";
import { getRewardTokenPriceUsd } from "aero-allocator/data";
import { withApiErrorHandling } from "@/lib/api-error";

export const GET = withApiErrorHandling("lp-deposit", async (req: Request) => {
  const params = new URL(req.url).searchParams;
  const maxPools = Math.min(60, Math.max(1, Number(params.get("maxPools") ?? 15) || 15));

  const [snap, rewardTokenPriceUsd] = await Promise.all([getMarketSnapshot(), getRewardTokenPriceUsd()]);
  return NextResponse.json(recommendLpDeposits(snap, rewardTokenPriceUsd, { maxPools }));
});
