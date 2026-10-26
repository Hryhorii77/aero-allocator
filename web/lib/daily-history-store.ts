import { get as getBlob, put } from "@vercel/blob";
import type { DailyHistory } from "./daily-history";

const pathFor = (chainId: number) => `gauge-daily-history-${chainId}.json`;

export async function loadDailyHistory(chainId: number): Promise<DailyHistory | null> {
  try {
    const res = await getBlob(pathFor(chainId), { access: "private" });
    if (!res || res.statusCode !== 200 || !res.stream) return null;
    const parsed = JSON.parse(await new Response(res.stream).text()) as Partial<DailyHistory>;
    if (parsed.version !== 1 || parsed.chainId !== chainId || !Array.isArray(parsed.gauges) || !Array.isArray(parsed.seen) || !Array.isArray(parsed.points)) return null;
    return parsed as DailyHistory;
  } catch (e) {
    console.error(JSON.stringify({ level: "error", tag: "daily-history", reason: "load-failed", message: e instanceof Error ? e.message : String(e) }));
    return null;
  }
}

export async function saveDailyHistory(history: DailyHistory): Promise<boolean> {
  try {
    await put(pathFor(history.chainId), JSON.stringify(history), { access: "private", addRandomSuffix: false, allowOverwrite: true, contentType: "application/json" });
    return true;
  } catch (e) {
    console.error(JSON.stringify({ level: "error", tag: "daily-history", reason: "save-failed", message: e instanceof Error ? e.message : String(e) }));
    return false;
  }
}
