import type { Address } from "viem";
import { client, getGauges, registryAbi } from "./gauges";
import { eventsWithin, RETAIN_DAYS, type Ledger } from "./fee-ledger";
import { usdOf } from "./fee-history";
import { feeChain, loadPrices } from "./gauge-fees-read";
import { nextDayToRecord, rollupDays, type Release } from "./daily-history";
import { loadDailyHistoryForUpdate, saveDailyHistory } from "./daily-history-store";
import { loadWeightHistory } from "./weight-history-store";

/**
 * Adds the UTC days that have finished since the last run to the long daily record, from the fee record and the weight snapshots. Called
 * by the ingest cron after both are brought up to date; does nothing (one blob read) until a new day has finished. Returns how many days
 * the record holds.
 */
export async function recordDailyHistory(chainId: number, ledger: Ledger, nowSec = Math.floor(Date.now() / 1000)): Promise<number> {
  const cfg = feeChain(chainId);
  // This record can't be rebuilt from the chain, so a failed read must never be treated as "no record yet" and written over. Skip this run.
  const read = await loadDailyHistoryForUpdate(chainId);
  if (read.state === "error") throw new Error("daily history could not be read; not writing over it");
  const history = read.state === "ok" ? read.value : null;
  const headSec = Math.floor(ledger.updatedAt / 1000);
  const coverageFromSec = headSec - (ledger.lastBlock - ledger.coverageFrom) * cfg.blockSec;
  if (nextDayToRecord(history, coverageFromSec, nowSec) === null) return history?.points.length ?? 0;

  const list = await getGauges(chainId);
  const rewards = await client(cfg).multicall({
    allowFailure: false,
    contracts: list.gauges.map((g) => ({ address: cfg.registry, abi: registryAbi, functionName: "gaugeToRewards", args: [g.gauge] }) as const),
  });
  const head = BigInt(ledger.lastBlock);
  const events = rewards.map((r) => eventsWithin(ledger, r, head, RETAIN_DAYS, cfg.blockSec));
  const prices = await loadPrices(cfg, [...new Set(events.flat().map((e) => e.token))] as Address[]);
  const price = (t: Address) => prices.get(t) ?? prices.get(t.toLowerCase()) ?? null;
  const releases = list.gauges.map((g, i) => ({
    gauge: g.gauge,
    releases: events[i].map((e): Release => ({ t: headSec - Number(head - e.blockNumber) * cfg.blockSec, usd: usdOf(e, price) })),
  }));

  const next = rollupDays(history, chainId, releases, coverageFromSec, await loadWeightHistory(chainId), nowSec);
  if (next && next !== history) await saveDailyHistory(next, read);
  return next?.points.length ?? 0;
}
