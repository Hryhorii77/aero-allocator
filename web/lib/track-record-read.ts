import { loadDailyHistory } from "./daily-history-store";
import { getGaugeFees } from "./gauge-fees-read";
import { getGauges } from "./gauges";
import { addEntry, inLogWindow, recommend, summarize, TRACK_CHAIN_ID, type TrackSummary } from "./track-record";
import { loadTrackLog, loadTrackLogForUpdate, saveTrackLog } from "./track-record-store";
import { readAutopilotSnap } from "./autopilot-read";
import type { DailyHistory } from "./daily-history";

export type TrackOutcome = "logged" | "already" | "outside-window" | "unrankable" | "load-failed" | "save-conflict" | "save-failed";

/**
 * Called by the fee cron on Base. Writes down today's recommendation if it is early enough in the UTC day and today has none yet. Never
 * back-fills: a missed day stays missed, because an entry made later would not be what the model said at the start of that day.
 */
export async function recordTrackEntry(nowSec = Math.floor(Date.now() / 1000)): Promise<TrackOutcome> {
  if (!inLogWindow(nowSec)) return "outside-window";
  // A failed read is not an empty log: saving after one would start a fresh file over the whole record. Skip; the next run retries.
  const read = await loadTrackLogForUpdate();
  if (read.state === "error") return "load-failed";
  const log = read.state === "ok" ? read.value : null;
  const day = Math.floor(nowSec / 86_400);
  if (log?.entries.some((e) => e.day === day)) return "already";
  const [list, fees] = await Promise.all([getGauges(TRACK_CHAIN_ID), getGaugeFees(TRACK_CHAIN_ID)]);
  const entry = recommend(list.gauges, fees, nowSec, list.cooldownSec);
  if (!entry) return "unrankable";
  // Where Autopilot's pools sit this morning, so a deposit there can be checked the same way two days later. Optional: a failed read
  // logs the split alone (a missed Autopilot day stays missed, like any other).
  const ap = await readAutopilotSnap(nowSec * 1000).catch((e) => {
    console.error(JSON.stringify({ level: "error", tag: "track-record", reason: "autopilot-read-failed", message: e instanceof Error ? e.message : String(e) }));
    return [];
  });
  if (ap.length > 0) entry.ap = ap;
  // Saved only over the version read above, so two overlapping runs can't both write; the loser's entry is the same day's anyway.
  const saved = await saveTrackLog(addEntry(log, entry), read);
  return saved === "saved" ? "logged" : saved === "conflict" ? "save-conflict" : "save-failed";
}

const TTL_MS = 5 * 60_000;
let cached: { at: number; value: TrackSummary } | null = null;

/** The summary the page and the API show. Cached for five minutes: it only changes once a day. */
export async function getTrackRecord(): Promise<TrackSummary> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.value;
  const [log, daily] = await Promise.all([loadTrackLog(), loadDailyHistory(TRACK_CHAIN_ID)]);
  // The other chains' daily records, only for the chains Autopilot's pools were on in the rows shown.
  const chains = [...new Set((log?.entries ?? []).flatMap((e) => (e.ap ?? []).flatMap((p) => p.parts.map((x) => x.c))))].filter((c) => c !== TRACK_CHAIN_ID);
  const dailies = new Map<number, DailyHistory | null>(await Promise.all(chains.map(async (c) => [c, await loadDailyHistory(c)] as const)));
  const value = summarize(log, daily, undefined, dailies);
  cached = { at: Date.now(), value };
  return value;
}
