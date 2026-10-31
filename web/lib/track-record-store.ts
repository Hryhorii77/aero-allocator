import { get as getBlob } from "@vercel/blob";
import { loadForUpdate, saveIfUnchanged, type Loaded, type SaveResult } from "./blob-json";
import { TRACK_CHAIN_ID, type TrackLog } from "./track-record";

const PATH = `track-record-${TRACK_CHAIN_ID}.json`;
const isTrackLog = (x: unknown): x is TrackLog => {
  const p = x as Partial<TrackLog> | null;
  return !!p && p.version === 1 && p.chainId === TRACK_CHAIN_ID && Array.isArray(p.entries);
};

export async function loadTrackLog(): Promise<TrackLog | null> {
  try {
    const res = await getBlob(PATH, { access: "private" });
    if (!res || res.statusCode !== 200 || !res.stream) return null;
    const parsed: unknown = JSON.parse(await new Response(res.stream).text());
    return isTrackLog(parsed) ? parsed : null;
  } catch (e) {
    console.error(JSON.stringify({ level: "error", tag: "track-record", reason: "load-failed", message: e instanceof Error ? e.message : String(e) }));
    return null;
  }
}

/** For the writer: tells a missing log from a failed read, and carries the ETag the save must match. */
export const loadTrackLogForUpdate = (): Promise<Loaded<TrackLog>> => loadForUpdate(PATH, isTrackLog, "track-record");

export const saveTrackLog = (log: TrackLog, read: Exclude<Loaded<TrackLog>, { state: "error" }>): Promise<SaveResult> =>
  saveIfUnchanged(PATH, log, read, "track-record");
