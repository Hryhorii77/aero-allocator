import { createPublicClient, http } from "viem";
import { base } from "viem/chains";
import { lpSugarAbi, rewardsSugarAbi } from "./abi.js";
import { ADDRESSES, BASE_RPC_URL, SETTINGS, currentEpochStart } from "./config.js";
import { getPrices, sumRewardsUsd, type TokenPrice } from "./prices.js";
import type { EpochStats, PoolInfo } from "./types.js";

function makeClient() {
  return createPublicClient({
    chain: base,
    transport: http(BASE_RPC_URL, { batch: true, retryCount: 3 }),
  });
}

type SugarClient = { readContract: (args: any) => Promise<any> };

let client: SugarClient | undefined;

export function getClient(): SugarClient {
  if (!client) client = makeClient();
  return client;
}

type RawLp = {
  lp: `0x${string}`;
  symbol: string;
  decimals: number;
  liquidity: bigint;
  type_: number;
  token0: `0x${string}`;
  reserve0: bigint;
  staked0: bigint;
  token1: `0x${string}`;
  reserve1: bigint;
  staked1: bigint;
  gauge: `0x${string}`;
  gauge_alive: boolean;
  emissions: bigint;
  pool_fee: bigint;
};

// Public RPCs rate-limit these heavy reads; back off hard before retrying.
async function withRetry<T>(fn: () => Promise<T>, attempts = 5): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
    }
  }
  throw lastErr;
}

async function readLpRange(limit: number, offset: number): Promise<readonly RawLp[]> {
  const c = getClient();
  return (await c.readContract({
    address: ADDRESSES.lpSugar,
    abi: lpSugarAbi,
    functionName: "all",
    args: [BigInt(limit), BigInt(offset), 0n],
  })) as readonly RawLp[];
}

/**
 * Dense page ranges (the v2/CL boundary around index 28k-34k) deterministically
 * exceed the eth_call budget at limit=500, so on failure split the range in
 * half instead of backing off — only leaf ranges get the full retry treatment.
 */
async function fetchLpPage(limit: number, offset: number): Promise<readonly RawLp[]> {
  if (limit <= 64) return withRetry(() => readLpRange(limit, offset));
  try {
    return await withRetry(() => readLpRange(limit, offset), 2);
  } catch {
    const half = Math.ceil(limit / 2);
    const [a, b] = await Promise.all([
      fetchLpPage(half, offset),
      fetchLpPage(limit - half, offset + half),
    ]);
    return [...a, ...b];
  }
}

function classifyPool(type_: number): { poolType: PoolInfo["poolType"]; tickSpacing: number | null } {
  // LpSugar convention: 0 = v2 stable, -1 = v2 volatile, >0 = CL tick spacing.
  if (type_ === 0) return { poolType: "v2-stable", tickSpacing: null };
  if (type_ === -1) return { poolType: "v2-volatile", tickSpacing: null };
  return { poolType: "concentrated", tickSpacing: type_ };
}

/**
 * Scan every pool (v2 factories first, CL/slipstream pools at high indexes),
 * price their reserves, and return gauge-enabled pools above the TVL floor,
 * sorted by staked TVL descending.
 */
let rawScanCache: { at: number; promise: Promise<RawLp[]> } | null = null;

async function fetchAllGaugePools(): Promise<RawLp[]> {
  const c = getClient();
  const total = Number(
    await c.readContract({ address: ADDRESSES.lpSugar, abi: lpSugarAbi, functionName: "count", args: [] }),
  );
  const pageCount = Math.ceil(total / SETTINGS.poolPageSize);
  const raws: RawLp[] = [];
  const failedPages: number[] = [];

  let page = 0;
  const workers = Array.from({ length: SETTINGS.scanConcurrency }, async () => {
    while (page < pageCount) {
      const p = page++;
      try {
        raws.push(...(await fetchLpPage(SETTINGS.poolPageSize, p * SETTINGS.poolPageSize)));
      } catch {
        failedPages.push(p);
      }
    }
  });
  await Promise.all(workers);

  // Missing pages skew everything (CL pools live at high offsets), so retry
  // stragglers sequentially once the parallel burst — and its rate-limit
  // pressure — is over.
  let unrecovered = 0;
  for (const p of failedPages) {
    try {
      raws.push(...(await fetchLpPage(SETTINGS.poolPageSize, p * SETTINGS.poolPageSize)));
    } catch {
      unrecovered++;
    }
  }
  if (unrecovered > 0) console.error(`scanPools: ${unrecovered}/${pageCount} pages missing after all retries`);

  return raws.filter((r) => r.gauge_alive && r.gauge !== "0x0000000000000000000000000000000000000000");
}

/** Pool set changes slowly; cache the raw scan and re-price reserves per call. */
function getGaugePools(): Promise<RawLp[]> {
  const now = Date.now();
  if (rawScanCache && now - rawScanCache.at < SETTINGS.poolScanTtlMs) return rawScanCache.promise;
  const promise = fetchAllGaugePools();
  rawScanCache = { at: now, promise };
  promise.catch(() => {
    rawScanCache = null;
  });
  return promise;
}

export async function scanPools(opts?: { minTvlUsd?: number; maxPools?: number }): Promise<PoolInfo[]> {
  const minTvl = opts?.minTvlUsd ?? SETTINGS.minTvlUsd;
  const withGauge = await getGaugePools();

  const tokenSet = new Set<string>();
  for (const r of withGauge) {
    tokenSet.add(r.token0.toLowerCase());
    tokenSet.add(r.token1.toLowerCase());
  }
  const prices = await getPrices([...tokenSet]);

  const toUsd = (token: string, amount: bigint, p: Map<string, TokenPrice | null>): number => {
    const price = p.get(token.toLowerCase());
    if (!price) return 0;
    return (Number(amount) / 10 ** price.decimals) * price.priceUsd;
  };

  // CL pools have no onchain symbol; synthesize one from priced token symbols.
  const displaySymbol = (r: RawLp, tickSpacing: number | null): string => {
    if (r.symbol) return r.symbol;
    const s0 = prices.get(r.token0.toLowerCase())?.symbol ?? r.token0.slice(0, 8);
    const s1 = prices.get(r.token1.toLowerCase())?.symbol ?? r.token1.slice(0, 8);
    return `CL${tickSpacing ?? ""}-${s0}/${s1}`;
  };

  const pools: PoolInfo[] = withGauge.map((r) => {
    const { poolType, tickSpacing } = classifyPool(r.type_);
    const tvlUsd = toUsd(r.token0, r.reserve0, prices) + toUsd(r.token1, r.reserve1, prices);
    const stakedTvlUsd = toUsd(r.token0, r.staked0, prices) + toUsd(r.token1, r.staked1, prices);
    return {
      lp: r.lp,
      symbol: displaySymbol(r, tickSpacing),
      poolType,
      tickSpacing,
      token0: r.token0,
      token1: r.token1,
      gauge: r.gauge,
      gaugeAlive: r.gauge_alive,
      reserve0: Number(r.reserve0),
      reserve1: Number(r.reserve1),
      staked0: Number(r.staked0),
      staked1: Number(r.staked1),
      tvlUsd,
      stakedTvlUsd,
      poolFeeBps: Number(r.pool_fee),
      emissionsPerSec: Number(r.emissions),
    };
  });

  const filtered = pools
    .filter((p) => p.tvlUsd >= minTvl)
    .sort((a, b) => b.stakedTvlUsd - a.stakedTvlUsd);

  return opts?.maxPools ? filtered.slice(0, opts.maxPools) : filtered;
}

type RawEpoch = {
  ts: bigint;
  lp: `0x${string}`;
  votes: bigint;
  emissions: bigint;
  bribes: readonly { token: `0x${string}`; amount: bigint }[];
  fees: readonly { token: `0x${string}`; amount: bigint }[];
};

/**
 * Fetch per-epoch history (votes, emissions, fees, bribes in USD) for one pool,
 * newest first. Includes the in-progress epoch as entry 0 when present.
 */
export async function fetchEpochHistory(lp: string, epochs: number = SETTINGS.historyEpochs): Promise<EpochStats[]> {
  const c = getClient();
  const raw = await withRetry(
    async () =>
      (await c.readContract({
        address: ADDRESSES.rewardsSugar,
        abi: rewardsSugarAbi,
        functionName: "epochsByAddress",
        args: [BigInt(epochs), 0n, lp as `0x${string}`],
      })) as readonly RawEpoch[],
  );

  const tokenSet = new Set<string>();
  for (const e of raw) {
    for (const b of e.bribes) tokenSet.add(b.token.toLowerCase());
    for (const f of e.fees) tokenSet.add(f.token.toLowerCase());
  }
  const prices = await getPrices([...tokenSet]);

  return raw
    .map((e) => ({
      ts: Number(e.ts),
      votes: Number(e.votes) / 1e18,
      emissions: Number(e.emissions) / 1e18,
      feesUsd: sumRewardsUsd(e.fees, prices),
      bribesUsd: sumRewardsUsd(e.bribes, prices),
    }))
    .sort((a, b) => b.ts - a.ts);
}

export async function fetchHistories(
  lps: string[],
  epochs: number = SETTINGS.historyEpochs,
): Promise<Map<string, EpochStats[]>> {
  const out = new Map<string, EpochStats[]>();
  let i = 0;
  let failed = 0;
  const workers = Array.from({ length: SETTINGS.rpcConcurrency }, async () => {
    while (i < lps.length) {
      const lp = lps[i++];
      try {
        out.set(lp.toLowerCase(), await fetchEpochHistory(lp, epochs));
      } catch {
        failed++;
        out.set(lp.toLowerCase(), []);
      }
    }
  });
  await Promise.all(workers);
  if (failed > 0) console.error(`fetchHistories: ${failed}/${lps.length} pools failed after retries`);
  return out;
}

/** Current AERO spot price in USD, for valuing staking (gauge) emissions. */
export async function getAeroPriceUsd(): Promise<number> {
  const prices = await getPrices([ADDRESSES.aero]);
  return prices.get(ADDRESSES.aero.toLowerCase())?.priceUsd ?? 0;
}

/** Split history into [inProgressEpoch | null, completedEpochs newest-first]. */
export function splitCurrentEpoch(history: EpochStats[]): {
  current: EpochStats | null;
  completed: EpochStats[];
} {
  const nowEpoch = currentEpochStart();
  const current = history.find((e) => e.ts >= nowEpoch) ?? null;
  const completed = history.filter((e) => e.ts < nowEpoch);
  return { current, completed };
}
