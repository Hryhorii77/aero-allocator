import { parseAbi, type Address } from "viem";
import { getPrices } from "aero-allocator/prices";
import { client, FACTORY_REGISTRY_BASE, getBaseGauges, registryAbi, type GaugeRow } from "./gauges";
import { BLOCKS_PER_HOUR, feePace, readFeeEvents, type LogReader } from "./gauge-fees";
import { AERO_LAUNCH_AT_MS } from "../app/launch";

const gaugeAbi = parseAbi(["function pendingFees() view returns (uint256, uint256)"]);
const rewardsAbi = parseAbi([
  "function lastPendingFees0() view returns (uint256)",
  "function lastPendingFees1() view returns (uint256)",
  "function bufferedFees0() view returns (uint256)",
  "function bufferedFees1() view returns (uint256)",
  "function token0() view returns (address)",
  "function token1() view returns (address)",
]);

/**
 * History read. Public RPCs serve event logs only ~10,000 blocks (about 5.5 hours) back from the head, so this is
 * what can be read without a log-capable RPC key. It is a recent rate, not the multi-day average that ranks the
 * next 47 hours best; the response says how many hours it covers.
 */
export const FEE_WINDOW_HOURS = 5;
const BY_WEIGHT = 40;
const BY_PENDING = 25;

export interface GaugeFee {
  gauge: Address;
  /** Fees to voters, USD per day, averaged over `windowHours`. */
  feesUsdPerDay: number;
  windowHours: number;
}

export interface GaugeFees {
  generatedAt: number;
  windowHours: number;
  /** Gauges with a pace that could be measured; the rest are unknown, not zero. */
  fees: GaugeFee[];
}

/** Gauges to estimate: the heaviest by weight plus those with the most unreleased fees right now (light gauges with heavy volume are the ones worth finding). */
export function pickCandidates(rows: GaugeRow[], pendingUsd: Map<Address, number>): Address[] {
  const heavy = rows.slice(0, BY_WEIGHT).map((r) => r.gauge);
  const taken = new Set(heavy);
  const busy = [...pendingUsd.entries()]
    .filter(([g]) => !taken.has(g))
    .sort((a, b) => b[1] - a[1])
    .slice(0, BY_PENDING)
    .map(([g]) => g);
  return [...heavy, ...busy];
}

export async function readGaugeFees(nowSec = Math.floor(Date.now() / 1000)): Promise<GaugeFees> {
  const c = client();
  const list = await getBaseGauges();
  const gauges = list.gauges.map((g) => g.gauge);
  const rewards = await c.multicall({
    allowFailure: false,
    contracts: gauges.map((g) => ({ address: FACTORY_REGISTRY_BASE, abi: registryAbi, functionName: "gaugeToRewards", args: [g] }) as const),
  });
  const rewardsOf = new Map(gauges.map((g, i) => [g, rewards[i]]));

  const fields = ["lastPendingFees0", "lastPendingFees1", "bufferedFees0", "bufferedFees1", "token0", "token1"] as const;
  const [pending, rw] = await Promise.all([
    c.multicall({ allowFailure: true, contracts: gauges.map((g) => ({ address: g, abi: gaugeAbi, functionName: "pendingFees" }) as const) }),
    c.multicall({ allowFailure: true, contracts: rewards.flatMap((a) => fields.map((f) => ({ address: a, abi: rewardsAbi, functionName: f }) as const)) }),
  ]);
  const pend = new Map<Address, Array<{ token: Address; amount: bigint }>>();
  const tokens = new Set<Address>();
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
    tokens.add(t0);
    tokens.add(t1);
  });

  const prices = await getPrices([...tokens]).catch(() => new Map());
  const price = (t: Address) => prices.get(t) ?? prices.get(t.toLowerCase()) ?? null;
  const pendingUsd = new Map<Address, number>(
    [...pend.entries()].map(([g, ps]) => [g, ps.reduce((a, p) => a + (price(p.token) ? (Number(p.amount < 0n ? 0n : p.amount) / 10 ** price(p.token).decimals) * price(p.token).priceUsd : 0), 0)]),
  );

  const picked = pickCandidates(list.gauges, pendingUsd);
  const startSec = Math.max(nowSec - FEE_WINDOW_HOURS * 3600, Math.floor(AERO_LAUNCH_AT_MS / 1000));
  const windowSec = nowSec - startSec;
  const head = await c.getBlockNumber();
  const fromBlock = head - BigInt(Math.ceil((windowSec / 3600) * BLOCKS_PER_HOUR));
  const events = await readFeeEvents(c as unknown as LogReader, picked.map((g) => rewardsOf.get(g)!), fromBlock, head);
  const evTokens = [...new Set(events.map((e) => e.token))].filter((t) => !tokens.has(t));
  if (evTokens.length) for (const [k, v] of await getPrices(evTokens).catch(() => new Map())) prices.set(k, v);

  const byRewards = new Map<Address, typeof events>();
  // Log addresses come back lowercase while the registry's are checksummed, so key by lowercase.
  for (const e of events) {
    const k = e.rewards.toLowerCase();
    byRewards.set(k as Address, [...(byRewards.get(k as Address) ?? []), e]);
  }
  const fees: GaugeFee[] = [];
  for (const g of picked) {
    const pace = feePace(byRewards.get(rewardsOf.get(g)!.toLowerCase() as Address) ?? [], pend.get(g) ?? [], head, price);
    if (pace) fees.push({ gauge: g, feesUsdPerDay: pace.usdPerDay, windowHours: pace.windowSec / 3600 });
  }
  return { generatedAt: nowSec * 1000, windowHours: windowSec / 3600, fees };
}

// Reading ~65 gauges' events takes several seconds on public RPCs; share one result for 15 minutes.
const TTL_MS = 15 * 60_000;
let cache: { at: number; value: GaugeFees } | null = null;
let inflight: Promise<GaugeFees> | null = null;

export async function getGaugeFees(): Promise<GaugeFees> {
  if (cache && Date.now() - cache.at <= TTL_MS) return cache.value;
  inflight ??= readGaugeFees().finally(() => {
    inflight = null;
  });
  const value = await inflight;
  cache = { at: Date.now(), value };
  return value;
}
