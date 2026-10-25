import { getGauges } from "./gauges";
import { computeFlows, recordSnapshot, type Flows } from "./weight-history";
import { loadWeightHistory, saveWeightHistory } from "./weight-history-store";

/** Takes a snapshot of the chain's gauge weights now (skipped if the last one is recent) and stores it. Called by the ingest cron. */
export async function snapshotWeights(chainId: number, nowSec = Math.floor(Date.now() / 1000)): Promise<number> {
  const [history, list] = await Promise.all([loadWeightHistory(chainId), getGauges(chainId)]);
  const next = recordSnapshot(history, chainId, list.gauges, nowSec);
  if (next !== history) await saveWeightHistory(next);
  return next.points.length;
}

const TTL_MS = 5 * 60_000;
const cache = new Map<number, { at: number; value: Flows }>();

/** How each gauge's share of weight moved over the last day (or as far back as the record goes); empty until there are two hours of snapshots. */
export async function getGaugeFlows(chainId: number): Promise<Flows> {
  const hit = cache.get(chainId);
  if (hit && Date.now() - hit.at <= TTL_MS) return hit.value;
  const value = computeFlows(await loadWeightHistory(chainId), Math.floor(Date.now() / 1000));
  const out = value.chainId === chainId ? value : { ...value, chainId };
  cache.set(chainId, { at: Date.now(), value: out });
  return out;
}
