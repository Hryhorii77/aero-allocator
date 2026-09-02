import { NextResponse } from "next/server";
import { simulateBribeImpact } from "aero-allocator/scoring";
import { calibratedSnapshot } from "@/lib/snapshot";
import { withApiErrorHandling } from "@/lib/api-error";

// A cold snapshot build can take close to a minute; this route can trigger
// one on its own (bribe simulation is on-demand, not part of the main
// dashboard load — see api/dashboard/route.ts). 60s is the ceiling on
// Vercel's Hobby plan; raise if on Pro/Enterprise and still hitting it.
export const maxDuration = 60;

export const GET = withApiErrorHandling("bribe", async (req: Request) => {
  const params = new URL(req.url).searchParams;
  const pool = params.get("pool");
  const bribeBudgetUsd = Number(params.get("bribeBudgetUsd"));

  if (!pool || !/^0x[0-9a-fA-F]{40}$/.test(pool)) {
    return NextResponse.json({ error: "pool must be a 0x-prefixed 40-hex-char address" }, { status: 400 });
  }
  if (!Number.isFinite(bribeBudgetUsd) || bribeBudgetUsd <= 0) {
    return NextResponse.json({ error: "bribeBudgetUsd must be a positive number" }, { status: 400 });
  }

  const snap = await calibratedSnapshot();
  // simulateBribeImpact throws on an expected application-level condition
  // (e.g. pool not found in the current snapshot) — a 400, not a bug worth
  // the structured error log withApiErrorHandling emits for 500s.
  try {
    return NextResponse.json(simulateBribeImpact(snap, pool, bribeBudgetUsd));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
});
