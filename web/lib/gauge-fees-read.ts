import { createPublicClient, fallback, http, parseAbi, type Address } from "viem";
import { PRESET, RPC_URL, RPC_URL_FALLBACK } from "aero-allocator/config";
import { getPrices } from "aero-allocator/prices";
import { BASE_CHAIN, chainById, type AeroChain } from "./aero-chains";
import { getChainPrices } from "./chain-prices";
import { client, getGauges, registryAbi } from "./gauges";
import { feePace, readFeeEvents, type LogReader } from "./gauge-fees";
import { appendEvents, coverageHours, eventsWithin, planRange, type Ledger } from "./fee-ledger";
import { loadLedger, saveLedger } from "./fee-ledger-store";

const gaugeAbi = parseAbi(["function pendingFees() view returns (uint256, uint256)"]);
const rewardsAbi = parseAbi([
  "function lastPendingFees0() view returns (uint256)",
  "function lastPendingFees1() view returns (uint256)",
  "function bufferedFees0() view returns (uint256)",
  "function bufferedFees1() view returns (uint256)",
  "function token0() view returns (address)",
  "function token1() view returns (address)",
]);

/** A record older than this is brought up to date by the read itself; the hourly job normally keeps it fresher. */
export const STALE_AFTER_MS = 90 * 60_000;
/** The ingest route does nothing when the record was updated more recently than this, so it is safe to leave public. */
export const MIN_INGEST_GAP_MS = 20 * 60_000;

/**
 * Event-log reads need an RPC that allows address lists over ~10,000 blocks. On Base a configured RPC_URL (often a
 * provider's free tier, which caps eth_getLogs ranges) can refuse them, so the public node known to allow it is
 * tried first and the configured ones only after it. Other chains use their own public nodes.
 */
export function logRpcUrls(cfg: AeroChain = BASE_CHAIN): string[] {
  const urls = cfg.id === BASE_CHAIN.id ? [PRESET.defaultRpcUrl, RPC_URL, RPC_URL_FALLBACK] : cfg.rpcs;
  return [...new Set(urls.filter((u): u is string => !!u))];
}

function logClient(cfg: AeroChain) {
  return createPublicClient({ chain: cfg.chain, transport: fallback(logRpcUrls(cfg).map((u) => http(u))) });
}

/** Base prices come from the engine (with its retry and stale fallback); other chains from the chain-aware helper. */
async function loadPrices(cfg: AeroChain, tokens: Address[]) {
  if (tokens.length === 0) return new Map();
  return cfg.id === BASE_CHAIN.id ? getPrices(tokens).catch(() => new Map()) : getChainPrices(cfg.llama, tokens);
}

export interface GaugeFee {
  gauge: Address;
  /** Fees to voters, USD per day, averaged over `windowHours`. */
  feesUsdPerDay: number;
  windowHours: number;
}

export interface GaugeFees {
  chainId: number;
  generatedAt: number;
  windowHours: number;
  /** Gauges with a pace that could be measured; the rest are unknown, not zero. */
  fees: GaugeFee[];
}

function feeChain(chainId: number): AeroChain {
  const cfg = chainById(chainId);
  if (!cfg || !cfg.feeLogs) throw new Error(`Fee pace is not measured on chain ${chainId}`);
  return cfg;
}


const memo = new Map<number, Ledger>();

/** Reads what happened since the record's last block (all gauges of one chain) and stores it. Returns the updated record. */
export async function updateFeeLedger(chainId = BASE_CHAIN.id, force = false): Promise<Ledger> {
  const cfg = feeChain(chainId);
  let ledger = (await loadLedger(chainId)) ?? memo.get(chainId) ?? null;
  if (ledger && !force && Date.now() - ledger.updatedAt < MIN_INGEST_GAP_MS) return ledger;
  const lc = logClient(cfg);
  const head = await lc.getBlockNumber();
  const list = await getGauges(chainId);
  const gauges = list.gauges.map((g) => g.gauge);
  const rewards = await client(cfg).multicall({
    allowFailure: false,
    contracts: gauges.map((g) => ({ address: cfg.registry, abi: registryAbi, functionName: "gaugeToRewards", args: [g] }) as const),
  });
  const range = planRange(ledger, head);
  const events = range.from <= head ? await readFeeEvents(lc as unknown as LogReader, rewards, range.from, head, 4) : [];
  ledger = appendEvents(ledger, events, { from: range.from, to: head, reset: range.reset }, Date.now(), cfg.blockSec);
  memo.set(chainId, ledger);
  await saveLedger(ledger, chainId);
  return ledger;
}

export async function readGaugeFees(chainId = BASE_CHAIN.id, nowSec = Math.floor(Date.now() / 1000)): Promise<GaugeFees> {
  const cfg = feeChain(chainId);
  const c = client(cfg);
  let ledger = (await loadLedger(chainId)) ?? memo.get(chainId) ?? null;
  if (!ledger || Date.now() - ledger.updatedAt > STALE_AFTER_MS) ledger = await updateFeeLedger(chainId, true);
  const head = await logClient(cfg).getBlockNumber();

  const list = await getGauges(chainId);
  const gauges = list.gauges.map((g) => g.gauge);
  const rewards = await c.multicall({
    allowFailure: false,
    contracts: gauges.map((g) => ({ address: cfg.registry, abi: registryAbi, functionName: "gaugeToRewards", args: [g] }) as const),
  });

  const fields = ["lastPendingFees0", "lastPendingFees1", "bufferedFees0", "bufferedFees1", "token0", "token1"] as const;
  const [pending, rw] = await Promise.all([
    c.multicall({ allowFailure: true, contracts: gauges.map((g) => ({ address: g, abi: gaugeAbi, functionName: "pendingFees" }) as const) }),
    c.multicall({ allowFailure: true, contracts: rewards.flatMap((a) => fields.map((f) => ({ address: a, abi: rewardsAbi, functionName: f }) as const)) }),
  ]);
  const pend = new Map<Address, Array<{ token: Address; amount: bigint }>>();
  gauges.forEach((g, i) => {
    const p = pending[i];
    const r = fields.map((_, k) => rw[i * fields.length + k]);
    if (p.status !== "success" || r.some((x) => x.status !== "success")) return;
    const [lp0, lp1, b0, b1, t0, t1] = r.map((x) => x.result) as [bigint, bigint, bigint, bigint, Address, Address];
    const [p0, p1] = p.result as readonly [bigint, bigint];
    pend.set(g, [
      { token: t0, amount: p0 - lp0 + b0 },
      { token: t1, amount: p1 - lp1 + b1 },
    ]);
  });

  const tokens = new Set<Address>([...pend.values()].flat().map((p) => p.token));
  for (const e of ledger.events) tokens.add(e.t);
  const prices = await loadPrices(cfg, [...tokens]);
  const price = (t: Address) => prices.get(t) ?? prices.get(t.toLowerCase()) ?? null;

  const fees: GaugeFee[] = [];
  gauges.forEach((g, i) => {
    const pace = feePace(eventsWithin(ledger, rewards[i], head, undefined, cfg.blockSec), pend.get(g) ?? [], head, price, cfg.blockSec);
    if (pace) fees.push({ gauge: g, feesUsdPerDay: pace.usdPerDay, windowHours: pace.windowSec / 3600 });
  });
  return { chainId, generatedAt: nowSec * 1000, windowHours: coverageHours(ledger, head, undefined, cfg.blockSec), fees };
}

// Share one result per chain for a few minutes; the work is the multicalls and pricing, the history comes from the record.
const TTL_MS = 5 * 60_000;
const cache = new Map<number, { at: number; value: GaugeFees }>();
const inflight = new Map<number, Promise<GaugeFees>>();

export async function getGaugeFees(chainId = BASE_CHAIN.id): Promise<GaugeFees> {
  feeChain(chainId);
  const hit = cache.get(chainId);
  if (hit && Date.now() - hit.at <= TTL_MS) return hit.value;
  let p = inflight.get(chainId);
  if (!p) {
    p = readGaugeFees(chainId).finally(() => inflight.delete(chainId));
    inflight.set(chainId, p);
  }
  const value = await p;
  cache.set(chainId, { at: Date.now(), value });
  return value;
}
