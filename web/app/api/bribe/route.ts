import { NextResponse } from "next/server";
import { simulateBribeImpact } from "aero-allocator/scoring";
import { calibratedSnapshot } from "@/lib/snapshot";

export async function GET(req: Request) {
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
  try {
    return NextResponse.json(simulateBribeImpact(snap, pool, bribeBudgetUsd));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
