import { NextResponse } from "next/server";
import { updateFeeLedger } from "@/lib/gauge-fees-read";
import { withApiErrorHandling } from "@/lib/api-error";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";

export const maxDuration = 60;

// Called hourly by a scheduled job to keep the fee record current. Public on purpose: it only reads public chain
// data, does nothing if the record was updated in the last 20 minutes, and writes nothing a caller controls.
export const GET = withApiErrorHandling("gauge-fees-ingest", async (req: Request) => {
  const rl = checkRateLimit(req, { key: "gauge-fees-ingest", limit: 6, windowMs: 60_000 });
  if (!rl.allowed) return rateLimitResponse(rl.retryAfterSec);
  const ledger = await updateFeeLedger();
  return NextResponse.json({ lastBlock: ledger.lastBlock, coverageFrom: ledger.coverageFrom, events: ledger.events.length, updatedAt: ledger.updatedAt });
});
