import { get as getBlob, put } from "@vercel/blob";
import type { Ledger } from "./fee-ledger";

/** Base keeps its original blob name so the record already stored stays in use. */
const pathFor = (chainId: number) => (chainId === 8453 ? "gauge-fee-ledger.json" : `gauge-fee-ledger-${chainId}.json`);

export async function loadLedger(chainId = 8453): Promise<Ledger | null> {
  try {
    const res = await getBlob(pathFor(chainId), { access: "private" });
    if (!res || res.statusCode !== 200 || !res.stream) return null;
    const parsed = JSON.parse(await new Response(res.stream).text()) as Partial<Ledger>;
    if (parsed.version !== 1 || !Array.isArray(parsed.events) || typeof parsed.lastBlock !== "number" || typeof parsed.coverageFrom !== "number") return null;
    return parsed as Ledger;
  } catch (e) {
    console.error(JSON.stringify({ level: "error", tag: "fee-ledger", reason: "load-failed", message: e instanceof Error ? e.message : String(e) }));
    return null;
  }
}

export async function saveLedger(ledger: Ledger, chainId = 8453): Promise<boolean> {
  try {
    await put(pathFor(chainId), JSON.stringify(ledger), { access: "private", addRandomSuffix: false, allowOverwrite: true, contentType: "application/json" });
    return true;
  } catch (e) {
    console.error(JSON.stringify({ level: "error", tag: "fee-ledger", reason: "save-failed", message: e instanceof Error ? e.message : String(e) }));
    return false;
  }
}
