import { createPublicClient, fallback, http, parseAbi, type Address } from "viem";
import { base } from "viem/chains";
import { PRESET, RPC_URL, RPC_URL_FALLBACK } from "aero-allocator/config";
import { SAERO } from "./saero";

// Gauge list for Aero on Base (the new system): FactoryRegistry -> gaugeFactories -> factoryToGauges, so no
// event scans are needed. Contract semantics are from Dromos-Labs/metadex-public natspec:
//  - emissionCap(gauge): the gauge's emission cap in tokens per second (NOT gaugeStates.ceiling, which is a
//    cumulative counter of share credited to the gauge).
//  - gaugeStates(gauge).point: decaying weight { bias, slope, ts, permanentStakeBalance }.
export const FACTORY_REGISTRY_BASE: Address = "0x7b2A2c12dC5Ea2a31455952a05031C3E4BB28F3E";

const registryAbi = parseAbi([
  "function gaugeFactories() view returns (address[])",
  "function factoryToGauges(address) view returns (address[])",
  "function gaugeToTarget(address) view returns (address)",
  "function emissionCap(address) view returns (uint128)",
]);
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

export interface GaugeRow {
  gauge: Address;
  pool: Address;
  symbol: string;
  /** Allocation weight in whole AERO-equivalent power. */
  weight: number;
  /** Share of all Base gauge weight, 0-100. */
  sharePct: number;
  /** Emission cap in AERO per week; 0 when the registry reports none. */
  capPerWeek: number;
  activated: boolean;
}

export interface GaugeList {
  chainId: 8453;
  generatedAt: number;
  totalWeight: number;
  gauges: GaugeRow[];
}

/** Turns raw per-gauge reads into rows, heaviest first, with each gauge's share of the total. */
export function buildGaugeRows(
  raw: Array<{ gauge: Address; pool: Address; symbol: string; point: GaugePoint; capPerSec: bigint; activated: boolean }>,
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
    }))
    .sort((a, b) => b.weight - a.weight);
  return { rows, totalWeight };
}

function client() {
  return createPublicClient({
    chain: base,
    transport: fallback([http(RPC_URL ?? PRESET.defaultRpcUrl), http(RPC_URL_FALLBACK)]),
  });
}

/** Reads every Aero gauge on Base. A few dozen multicalls; the route caches the result. */
export async function readBaseGauges(nowSec = Math.floor(Date.now() / 1000)): Promise<GaugeList> {
  const c = client();
  const factories = await c.readContract({ address: FACTORY_REGISTRY_BASE, abi: registryAbi, functionName: "gaugeFactories" });
  const lists = await Promise.all(
    factories.map((f) => c.readContract({ address: FACTORY_REGISTRY_BASE, abi: registryAbi, functionName: "factoryToGauges", args: [f] })),
  );
  const gauges = [...new Set(lists.flat())];

  const per = await c.multicall({
    allowFailure: false,
    contracts: gauges.flatMap((g) => [
      { address: FACTORY_REGISTRY_BASE, abi: registryAbi, functionName: "gaugeToTarget", args: [g] },
      { address: FACTORY_REGISTRY_BASE, abi: registryAbi, functionName: "emissionCap", args: [g] },
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

  const raw = gauges.map((gauge, i) => {
    const state = per[i * 3 + 2] as readonly [bigint, bigint, number, boolean, boolean, bigint, bigint, bigint, { bias: bigint; slope: bigint; ts: number; permanentStakeBalance: bigint }];
    return {
      gauge,
      pool: pools[i],
      symbol: `${symbolOf.get(tokens[i * 2] as Address)}/${symbolOf.get(tokens[i * 2 + 1] as Address)}`,
      point: state[8],
      capPerSec: per[i * 3 + 1] as bigint,
      activated: state[4],
    };
  });
  const { rows, totalWeight } = buildGaugeRows(raw, nowSec);
  return { chainId: 8453, generatedAt: nowSec * 1000, totalWeight, gauges: rows };
}
