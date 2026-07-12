import { NextResponse } from "next/server";
import { getMarketSnapshot, recommendAllocation } from "aero-allocator/scoring";

export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const objective = params.get("objective") === "protocol_efficiency" ? "protocol_efficiency" : "voter_roi";
  const votingPower = Math.max(1, Number(params.get("votingPower") ?? 10000) || 10000);
  const maxPools = Math.min(20, Math.max(2, Number(params.get("maxPools") ?? 8) || 8));

  const snap = await getMarketSnapshot();
  return NextResponse.json(recommendAllocation(snap, objective, maxPools, votingPower));
}
