import { NextResponse } from "next/server";
import { recommendAllocation } from "aero-allocator/scoring";
import type { AllocationObjective } from "aero-allocator/types";
import { calibratedSnapshot } from "@/lib/snapshot";
import { withApiErrorHandling } from "@/lib/api-error";

const OBJECTIVES: AllocationObjective[] = ["protocol_efficiency", "voter_roi", "edge_hunter"];

export const GET = withApiErrorHandling("allocation", async (req: Request) => {
  const params = new URL(req.url).searchParams;
  const requested = params.get("objective");
  const objective = OBJECTIVES.includes(requested as AllocationObjective)
    ? (requested as AllocationObjective)
    : "voter_roi";
  const votingPower = Math.max(1, Number(params.get("votingPower") ?? 10000) || 10000);
  const maxPools = Math.min(20, Math.max(2, Number(params.get("maxPools") ?? 8) || 8));

  const snap = await calibratedSnapshot();
  return NextResponse.json(recommendAllocation(snap, objective, maxPools, votingPower));
});
