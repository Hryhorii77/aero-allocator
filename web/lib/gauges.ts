import { createPublicClient, fallback, http, parseAbi, type Address } from "viem";
import { PRESET, RPC_URL, RPC_URL_FALLBACK } from "aero-allocator/config";
import { AERO_CHAINS, BASE_CHAIN, chainById, type AeroChain } from "./aero-chains";
import { getChainPrices } from "./chain-prices";
import { SAERO } from "./saero";

// Gauge list for Aero on Base (the new system): FactoryRegistry -> gaugeFactories -> factoryToGauges, so no
// event scans are needed. Contract semantics are from Dromos-Labs/metadex-public natspec:
//  - emissionCap(gauge): the gauge's emission cap in tokens per second (NOT gaugeStates.ceiling, which is a
//    cumulative counter of share credited to the gauge).
//  - gaugeStates(gauge).point: decaying weight { bias, slope, ts, permanentStakeBalance }.
export const FACTORY_REGISTRY_BASE: Address = BASE_CHAIN.registry;

export const registryAbi = parseAbi([
  "function gaugeFactories() view returns (address[])",
  "function factoryToGauges(address) view returns (address[])",
  "function gaugeToTarget(address) view returns (address)",
  "function emissionCap(address) view returns (uint128)",
  "function gaugeToRewards(address) view returns (address)",
]);
// Incentive programs live on each gauge's rewards contract. Program ids are 1-based (id 0 is an empty slot),
// \`rate\` is tokens (raw units) per second scaled by 1e18, and a program streams between start and end.
const incentiveAbi = parseAbi([
  "function incentiveCount() view returns (uint256)",
  "function incentive(uint256) view returns ((address token, uint256 amount, uint256 rate, uint48 start, uint48 end, address creator))",
]);
const RATE_SCALE = 1e18;
const leafAbi = parseAbi([
  "function gaugeStates(address) view returns (uint128 ceiling, uint128 claimed, uint48 lastSettlement, bool isRegistered, bool isActivated, uint128 surplus, uint256 lastIndex, uint256 lastTimeIndex, (int128 bias, int128 slope, uint48 ts, uint128 permanentStakeBalance) point)",
]);
const poolAbi = parseAbi(["function token0() view returns (address)", "function token1() view returns (address)"]);
const erc20Abi = parseAbi(["function symbol() view returns (string)"]);

const WEEK = 604_800;

export interface GaugePoint {
  bias: bigint;
  slope: bigint;
  ts: number;
  permanentStakeBalance: bigint;
}

/** Current allocation weight (whole tokens): the decaying part, floored at 0, plus the permanent part. */
export function gaugeWeight(p: GaugePoint, nowSec: number): number {
  let decaying = p.bias - p.slope * BigInt(Math.max(0, nowSec - p.ts));
  if (decaying < 0n) decaying = 0n;
  return Number(decaying + p.permanentStakeBalance) / 1e18;
}

/** A per-second emission cap (18-decimals) as whole tokens per week. */
export function weeklyCap(capPerSec: bigint): number {
  return (Number(capPerSec) / 1e18) * WEEK;
}

export interface IncentiveProgram {
  token: Address;
  rate: bigint;
  start: number;
  end: number;
}

/** USD per week streamed right now by the programs that are active at `nowSec`; tokens without a price count as 0. */
export function activeIncentiveUsdPerWeek(
  programs: IncentiveProgram[],
  nowSec: number,
  price: (token: Address) => { priceUsd: number; decimals: number } | null | undefined,
): number {
  let usd = 0;
  for (const p of programs) {
    if (p.start > nowSec || p.end <= nowSec) continue;
    const pr = price(p.token);
    if (!pr) continue;
    usd += ((Number(p.rate) / RATE_SCALE) * WEEK * pr.priceUsd) / 10 ** pr.decimals;
  }
  return usd;
}

export interface GaugeRow {
  gauge: Address;
  pool: Address;
  symbol: string;
  /** Allocation weight in whole AERO-equivalent power. */
  weight: number;
  /** Share of all gauge weight on this chain, 0-100. */
  sharePct: number;
  /** Emission cap in AERO per week; 0 when the registry reports none. */
  capPerWeek: number;
  activated: boolean;
  /** Incentives streaming now, in USD per week (0 when none, or none priced). */
  incentivesUsdPerWeek: number;
  /** Incentives per 1,000 of allocated power per week: the pull of the gauge's incentives on a marginal allocator. */
  incentivesUsdPer1k: number;
}

export interface GaugeList {
  chainId: number;
  generatedAt: number;
  totalWeight: number;
  gauges: GaugeRow[];
}

/** Turns raw per-gauge reads into rows, heaviest first, with each gauge's share of the total. */
export function buildGaugeRows(
  raw: Array<{ gauge: Address; pool: Address; symbol: string; point: GaugePoint; capPerSec: bigint; activated: boolean; incentivesUsdPerWeek?: number }>,
  nowSec: number,
): { rows: GaugeRow[]; totalWeight: number } {
  const weights = raw.map((r) => gaugeWeight(r.point, nowSec));
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  const rows = raw
    .map((r, i): GaugeRow => ({
      gauge: r.gauge,
      pool: r.pool,
      symbol: r.symbol,
      weight: weights[i],
      sharePct: totalWeight > 0 ? (weights[i] / totalWeight) * 100 : 0,
      capPerWeek: weeklyCap(r.capPerSec),
      activated: r.activated,
      incentivesUsdPerWeek: r.incentivesUsdPerWeek ?? 0,
      incentivesUsdPer1k: weights[i] > 0 ? ((r.incentivesUsdPerWeek ?? 0) / weights[i]) * 1000 : 0,
    }))
    .sort((a, b) => b.weight - a.weight);
  return { rows, totalWeight };
}

/** A client for one Aero chain. Base keeps the configured RPC_URL (+ fallback); the others use their public nodes. */
export function client(cfg: AeroChain = BASE_CHAIN) {
  const urls = cfg.id === BASE_CHAIN.id ? [RPC_URL ?? PRESET.defaultRpcUrl, RPC_URL_FALLBACK] : cfg.rpcs;
  return createPublicClient({ chain: cfg.chain, transport: fallback(urls.filter((u): u is string => !!u).map((u) => http(u))) });
}

/** Reads every Aero gauge on one chain. A few dozen multicalls; the route caches the result. */
export async function readGauges(cfg: AeroChain, nowSec = Math.floor(Date.now() / 1000)): Promise<GaugeList> {
  const c = client(cfg);
  const registry = cfg.registry;
  const factories = await c.readContract({ address: registry, abi: registryAbi, functionName: "gaugeFactories" });
  const lists = await Promise.all(
    factories.map((f) => c.readContract({ address: registry, abi: registryAbi, functionName: "factoryToGauges", args: [f] })),
  );
  const gauges = [...new Set(lists.flat())];

  const per = await c.multicall({
    allowFailure: false,
    contracts: gauges.flatMap((g) => [
      { address: registry, abi: registryAbi, functionName: "gaugeToTarget", args: [g] },
      { address: registry, abi: registryAbi, functionName: "emissionCap", args: [g] },
      { address: SAERO.leafVoter, abi: leafAbi, functionName: "gaugeStates", args: [g] },
    ] as const),
  });
  const pools = gauges.map((_, i) => per[i * 3] as Address);
  const tokens = await c.multicall({
    allowFailure: false,
    contracts: pools.flatMap((p) => [
      { address: p, abi: poolAbi, functionName: "token0" },
      { address: p, abi: poolAbi, functionName: "token1" },
    ] as const),
  });
  const uniqueTokens = [...new Set(tokens as Address[])];
  const symbols = await c.multicall({
    allowFailure: true,
    contracts: uniqueTokens.map((t) => ({ address: t, abi: erc20Abi, functionName: "symbol" }) as const),
  });
  const symbolOf = new Map(uniqueTokens.map((t, i) => [t, symbols[i].status === "success" ? String(symbols[i].result) : t.slice(0, 6)]));

  const rewards = await c.multicall({
    allowFailure: false,
    contracts: gauges.map((g) => ({ address: registry, abi: registryAbi, functionName: "gaugeToRewards", args: [g] }) as const),
  });
  const counts = await c.multicall({
    allowFailure: true,
    contracts: rewards.map((r) => ({ address: r, abi: incentiveAbi, functionName: "incentiveCount" }) as const),
  });
  const progCalls = rewards.flatMap((r, gi) => {
    const n = counts[gi].status === "success" ? Number(counts[gi].result) : 0;
    return Array.from({ length: Math.min(n, 50) }, (_, k) => ({ gi, id: BigInt(k + 1), r }));
  });
  const progRes = await c.multicall({
    allowFailure: true,
    contracts: progCalls.map((x) => ({ address: x.r, abi: incentiveAbi, functionName: "incentive", args: [x.id] }) as const),
  });
  const byGauge: IncentiveProgram[][] = gauges.map(() => []);
  progRes.forEach((res, i) => {
    if (res.status !== "success") return;
    const p = res.result;
    if (p.end > nowSec && p.start <= nowSec) byGauge[progCalls[i].gi].push({ token: p.token, rate: p.rate, start: p.start, end: p.end });
  });
  const incentiveTokens = [...new Set(byGauge.flat().map((p) => p.token))];
  const prices = incentiveTokens.length ? await getChainPrices(cfg.llama, incentiveTokens) : new Map();
  const priceOf = (t: Address) => prices.get(t) ?? prices.get(t.toLowerCase()) ?? null;

  const raw = gauges.map((gauge, i) => {
    const state = per[i * 3 + 2] as readonly [bigint, bigint, number, boolean, boolean, bigint, bigint, bigint, { bias: bigint; slope: bigint; ts: number; permanentStakeBalance: bigint }];
    return {
      gauge,
      pool: pools[i],
      symbol: `${symbolOf.get(tokens[i * 2] as Address)}/${symbolOf.get(tokens[i * 2 + 1] as Address)}`,
      point: state[8],
      capPerSec: per[i * 3 + 1] as bigint,
      activated: state[4],
      incentivesUsdPerWeek: activeIncentiveUsdPerWeek(byGauge[i], nowSec, priceOf),
    };
  });
  const { rows, totalWeight } = buildGaugeRows(raw, nowSec);
  return { chainId: cfg.id, generatedAt: nowSec * 1000, totalWeight, gauges: rows };
}

// One read of ~270 gauges costs a few dozen RPC multicalls, so share it across callers for a minute.
const LIST_TTL_MS = 60_000;
const caches = new Map<number, { at: number; value: GaugeList }>();
const inflight = new Map<number, Promise<GaugeList>>();

export async function getGauges(chainId: number): Promise<GaugeList> {
  const cfg = chainById(chainId);
  if (!cfg) throw new Error(`Unsupported chain ${chainId}`);
  const hit = caches.get(chainId);
  if (hit && Date.now() - hit.at <= LIST_TTL_MS) return hit.value;
  let p = inflight.get(chainId);
  if (!p) {
    p = readGauges(cfg).finally(() => inflight.delete(chainId));
    inflight.set(chainId, p);
  }
  const value = await p;
  caches.set(chainId, { at: Date.now(), value });
  return value;
}

export const getBaseGauges = () => getGauges(BASE_CHAIN.id);
export const SUPPORTED_CHAIN_IDS = AERO_CHAINS.map((c) => c.id);
