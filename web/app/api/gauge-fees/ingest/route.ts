import { NextResponse } from "next/server";
import { AERO_CHAINS, BASE_CHAIN } from "@/lib/aero-chains";
import { updateFeeLedger } from "@/lib/gauge-fees-read";
import { snapshotWeights } from "@/lib/weight-history-read";
import { recordDailyHistory } from "@/lib/daily-history-read";
import { withApiErrorHandling } from "@/lib/api-error";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { recordTrackEntry } from "@/lib/track-record-read";
import { TRACK_CHAIN_ID } from "@/lib/track-record";

export const maxDuration = 60;

const FEE_CHAIN_IDS = AERO_CHAINS.filter((c) => c.feeLogs).map((c) => c.id);

// Called every 30 min by Vercel Cron (web/vercel.json; GitHub's own schedules ran hours late, so there is no workflow for it) to keep the fee record current. It only reads public chain
// data, does nothing if the record was updated in the last 20 minutes, and writes nothing a caller controls.
export const GET = withApiErrorHandling("gauge-fees-ingest", async (req: Request) => {
  // Vercel Cron sends CRON_SECRET as a bearer token and anyone else is turned away. A deployed site without the secret refuses
  // everyone instead of leaving the route open (a forgotten setting must not expose it); only local dev and tests run without it.
  const secret = process.env.CRON_SECRET;
  if (secret ? req.headers.get("authorization") !== `Bearer ${secret}` : process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const rl = checkRateLimit(req, { key: "gauge-fees-ingest", limit: 12, windowMs: 60_000 });
  if (!rl.allowed) return rateLimitResponse(rl.retryAfterSec);
  const raw = new URL(req.url).searchParams.get("chain");
  const chainId = raw === null ? BASE_CHAIN.id : Number(raw);
  if (!FEE_CHAIN_IDS.includes(chainId)) return NextResponse.json({ error: "fee pace is not measured on this chain", supported: FEE_CHAIN_IDS }, { status: 400 });
  const ledger = await updateFeeLedger(chainId);
  // The weight snapshot rides on the same cron; a failure here must not fail the fee record.
  const snapshots = await snapshotWeights(chainId).catch((e) => {
    console.error(JSON.stringify({ level: "error", route: "gauge-fees-ingest", step: "weights", message: e instanceof Error ? e.message : String(e) }));
    return null;
  });
  // The daily record rolls up what the two above hold once a day finishes; it too must not fail the fee record.
  const dailyDays = await recordDailyHistory(chainId, ledger).catch((e) => {
    console.error(JSON.stringify({ level: "error", route: "gauge-fees-ingest", step: "daily", message: e instanceof Error ? e.message : String(e) }));
    return null;
  });
  // Once a day on Base, the recommendation is written down for the track record (it can't be rebuilt later); a failure here must not fail the fee record either.
  const tracked =
    chainId === TRACK_CHAIN_ID
      ? await recordTrackEntry().catch((e) => {
          console.error(JSON.stringify({ level: "error", route: "gauge-fees-ingest", step: "track-record", message: e instanceof Error ? e.message : String(e) }));
          return null;
        })
      : undefined;
  return NextResponse.json({ chainId, lastBlock: ledger.lastBlock, coverageFrom: ledger.coverageFrom, events: ledger.events.length, updatedAt: ledger.updatedAt, weightSnapshots: snapshots, dailyDays, ...(tracked !== undefined ? { tracked } : {}) });
});
