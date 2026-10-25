import { get as getBlob, put } from "@vercel/blob";
import type { WeightHistory } from "./weight-history";

const pathFor = (chainId: number) => `gauge-weight-history-${chainId}.json`;

export async function loadWeightHistory(chainId: number): Promise<WeightHistory | null> {
  try {
    const res = await getBlob(pathFor(chainId), { access: "private" });
    if (!res || res.statusCode !== 200 || !res.stream) return null;
    const parsed = JSON.parse(await new Response(res.stream).text()) as Partial<WeightHistory>;
    if (parsed.version !== 1 || parsed.chainId !== chainId || !Array.isArray(parsed.gauges) || !Array.isArray(parsed.points)) return null;
    return parsed as WeightHistory;
  } catch (e) {
    console.error(JSON.stringify({ level: "error", tag: "weight-history", reason: "load-failed", message: e instanceof Error ? e.message : String(e) }));
    return null;
  }
}

export async function saveWeightHistory(history: WeightHistory): Promise<boolean> {
  try {
    await put(pathFor(history.chainId), JSON.stringify(history), { access: "private", addRandomSuffix: false, allowOverwrite: true, contentType: "application/json" });
    return true;
  } catch (e) {
    console.error(JSON.stringify({ level: "error", tag: "weight-history", reason: "save-failed", message: e instanceof Error ? e.message : String(e) }));
    return false;
  }
}
