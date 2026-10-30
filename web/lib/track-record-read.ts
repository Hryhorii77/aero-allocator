import { loadDailyHistory } from "./daily-history-store";
import { getGaugeFees } from "./gauge-fees-read";
import { getGauges } from "./gauges";
import { addEntry, inLogWindow, recommend, summarize, TRACK_CHAIN_ID, type TrackSummary } from "./track-record";
import { loadTrackLog, saveTrackLog } from "./track-record-store";

export type TrackOutcome = "logged" | "already" | "outside-window" | "unrankable" | "save-failed";

/**
 * Called by the fee cron on Base. Writes down today's recommendation if it is early enough in the UTC day and today has none yet. Never
 * back-fills: a missed day stays missed, because an entry made later would not be what the model said at the start of that day.
 */
export async function recordTrackEntry(nowSec = Math.floor(Date.now() / 1000)): Promise<TrackOutcome> {
  if (!inLogWindow(nowSec)) return "outside-window";
  const log = await loadTrackLog();
  const day = Math.floor(nowSec / 86_400);
  if (log?.entries.some((e) => e.day === day)) return "already";
  const [list, fees] = await Promise.all([getGauges(TRACK_CHAIN_ID), getGaugeFees(TRACK_CHAIN_ID)]);
  const entry = recommend(list.gauges, fees, nowSec, list.cooldownSec);
  if (!entry) return "unrankable";
  return (await saveTrackLog(addEntry(log, entry))) ? "logged" : "save-failed";
}

const TTL_MS = 5 * 60_000;
let cached: { at: number; value: TrackSummary } | null = null;

/** The summary the page and the API show. Cached for five minutes: it only changes once a day. */
export async function getTrackRecord(): Promise<TrackSummary> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.value;
  const [log, daily] = await Promise.all([loadTrackLog(), loadDailyHistory(TRACK_CHAIN_ID)]);
  const value = summarize(log, daily);
  cached = { at: Date.now(), value };
  return value;
}
