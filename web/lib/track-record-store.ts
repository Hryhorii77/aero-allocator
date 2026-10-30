import { get as getBlob, put } from "@vercel/blob";
import { TRACK_CHAIN_ID, type TrackLog } from "./track-record";

const PATH = `track-record-${TRACK_CHAIN_ID}.json`;

export async function loadTrackLog(): Promise<TrackLog | null> {
  try {
    const res = await getBlob(PATH, { access: "private" });
    if (!res || res.statusCode !== 200 || !res.stream) return null;
    const parsed = JSON.parse(await new Response(res.stream).text()) as Partial<TrackLog>;
    if (parsed.version !== 1 || parsed.chainId !== TRACK_CHAIN_ID || !Array.isArray(parsed.entries)) return null;
    return parsed as TrackLog;
  } catch (e) {
    console.error(JSON.stringify({ level: "error", tag: "track-record", reason: "load-failed", message: e instanceof Error ? e.message : String(e) }));
    return null;
  }
}

export async function saveTrackLog(log: TrackLog): Promise<boolean> {
  try {
    await put(PATH, JSON.stringify(log), { access: "private", addRandomSuffix: false, allowOverwrite: true, contentType: "application/json" });
    return true;
  } catch (e) {
    console.error(JSON.stringify({ level: "error", tag: "track-record", reason: "save-failed", message: e instanceof Error ? e.message : String(e) }));
    return false;
  }
}
