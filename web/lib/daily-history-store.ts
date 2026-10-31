import { get as getBlob } from "@vercel/blob";
import { loadForUpdate, saveIfUnchanged, type Loaded, type SaveResult } from "./blob-json";
import type { DailyHistory } from "./daily-history";

const pathFor = (chainId: number) => `gauge-daily-history-${chainId}.json`;
const isDailyHistory = (chainId: number) => (x: unknown): x is DailyHistory => {
  const p = x as Partial<DailyHistory> | null;
  return !!p && p.version === 1 && p.chainId === chainId && Array.isArray(p.gauges) && Array.isArray(p.seen) && Array.isArray(p.points);
};

export async function loadDailyHistory(chainId: number): Promise<DailyHistory | null> {
  try {
    const res = await getBlob(pathFor(chainId), { access: "private" });
    if (!res || res.statusCode !== 200 || !res.stream) return null;
    const parsed: unknown = JSON.parse(await new Response(res.stream).text());
    return isDailyHistory(chainId)(parsed) ? parsed : null;
  } catch (e) {
    console.error(JSON.stringify({ level: "error", tag: "daily-history", reason: "load-failed", message: e instanceof Error ? e.message : String(e) }));
    return null;
  }
}

/** For the writer: tells a missing record from a failed read, and carries the ETag the save must match. */
export const loadDailyHistoryForUpdate = (chainId: number): Promise<Loaded<DailyHistory>> => loadForUpdate(pathFor(chainId), isDailyHistory(chainId), "daily-history");

export const saveDailyHistory = (history: DailyHistory, read: Exclude<Loaded<DailyHistory>, { state: "error" }>): Promise<SaveResult> =>
  saveIfUnchanged(pathFor(history.chainId), history, read, "daily-history");
