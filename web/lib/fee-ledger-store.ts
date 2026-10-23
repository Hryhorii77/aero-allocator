import { get as getBlob, put } from "@vercel/blob";
import type { Ledger } from "./fee-ledger";

const PATHNAME = "gauge-fee-ledger.json";

export async function loadLedger(): Promise<Ledger | null> {
  try {
    const res = await getBlob(PATHNAME, { access: "private" });
    if (!res || res.statusCode !== 200 || !res.stream) return null;
    const parsed = JSON.parse(await new Response(res.stream).text()) as Partial<Ledger>;
    if (parsed.version !== 1 || !Array.isArray(parsed.events) || typeof parsed.lastBlock !== "number" || typeof parsed.coverageFrom !== "number") return null;
    return parsed as Ledger;
  } catch (e) {
    console.error(JSON.stringify({ level: "error", tag: "fee-ledger", reason: "load-failed", message: e instanceof Error ? e.message : String(e) }));
    return null;
  }
}

export async function saveLedger(ledger: Ledger): Promise<boolean> {
  try {
    await put(PATHNAME, JSON.stringify(ledger), { access: "private", addRandomSuffix: false, allowOverwrite: true, contentType: "application/json" });
    return true;
  } catch (e) {
    console.error(JSON.stringify({ level: "error", tag: "fee-ledger", reason: "save-failed", message: e instanceof Error ? e.message : String(e) }));
    return false;
  }
}
