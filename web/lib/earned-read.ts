import { createPublicClient, fallback, http, type Address, type PublicClient } from "viem";
import { AERO_CHAINS, type AeroChain } from "./aero-chains";
import {
  chainTotal,
  combineChains,
  erc20MetaAbi,
  MAX_CHECKPOINTS,
  MAX_PROGRAMS_PER_GAUGE,
  registryRewardsAbi,
  rewardsManagerAbi,
  summariseAmounts,
  type EarnedAll,
  type EarnedChain,
  type TokenMeta,
} from "./earned";
import { SAERO, saeroLeafAbi } from "./saero";

// Reads, in the browser, what a position has earned and not claimed on every Aero chain: fees and incentives on the gauges it sits on
// there now. Each chain is read from its own public node (they allow cross-origin reads; Base goes through the wallet config's node), so
// the position never reaches our server. Only public token addresses go to /api/token-prices for USD values.

const ZERO = /^0x0+$/;
const PRICE_BATCH = 12; // the price route's limit per call

async function clientFor(cfg: AeroChain): Promise<PublicClient> {
  if (cfg.rpcs.length === 0) {
    const [{ getPublicClient }, { wagmiConfig }] = await Promise.all([import("wagmi/actions"), import("./wagmi")]);
    const c = getPublicClient(wagmiConfig, { chainId: cfg.id as never });
    if (!c) throw new Error(`no client for chain ${cfg.id}`);
    return c as unknown as PublicClient;
  }
  return createPublicClient({ chain: cfg.chain, transport: fallback(cfg.rpcs.map((u) => http(u))) }) as PublicClient;
}

async function pricesFor(chainId: number, tokens: string[], fetchFn: typeof fetch): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (let i = 0; i < tokens.length; i += PRICE_BATCH) {
    const chunk = tokens.slice(i, i + PRICE_BATCH);
    const got = await fetchFn(`/api/token-prices?chain=${chainId}&tokens=${chunk.join(",")}`)
      .then((r) => (r.ok ? (r.json() as Promise<{ prices: Record<string, number> }>) : { prices: {} }))
      .then((j) => j.prices ?? {})
      .catch(() => ({}) as Record<string, number>);
    Object.assign(out, got);
  }
  return out;
}

/** One chain: null when the position has no gauges there. `truncated` when a gauge had more incentive programs than were read. */
export async function readEarnedChain(cfg: AeroChain, tokenId: bigint, client: PublicClient, fetchFn: typeof fetch = fetch): Promise<{ chain: EarnedChain; truncated: boolean } | null> {
  const listed = (await client.readContract({ address: SAERO.leafVoter, abi: saeroLeafAbi, functionName: "allocatedGauges", args: [tokenId] })) as Address[];
  const gauges = listed.filter((g) => !ZERO.test(g));
  if (gauges.length === 0) return null;
  const managers = (await client.multicall({
    allowFailure: false,
    contracts: gauges.map((g) => ({ address: cfg.registry, abi: registryRewardsAbi, functionName: "gaugeToRewards" as const, args: [g] as const })),
  })) as Address[];
  const base = (await client.multicall({
    allowFailure: false,
    contracts: managers.flatMap((m) => [
      { address: m, abi: rewardsManagerAbi, functionName: "earnedFees" as const, args: [tokenId, MAX_CHECKPOINTS] as const },
      { address: m, abi: rewardsManagerAbi, functionName: "token0" as const },
      { address: m, abi: rewardsManagerAbi, functionName: "token1" as const },
      { address: m, abi: rewardsManagerAbi, functionName: "incentiveCount" as const },
    ]),
  })) as unknown[];
  const fees: Array<{ token: Address; amount: bigint }> = [];
  const programs: Array<{ manager: Address; id: bigint }> = [];
  let truncated = false;
  managers.forEach((m, i) => {
    const [a0, a1] = base[i * 4] as readonly [bigint, bigint];
    fees.push({ token: base[i * 4 + 1] as Address, amount: a0 }, { token: base[i * 4 + 2] as Address, amount: a1 });
    const count = Number(base[i * 4 + 3] as bigint);
    if (count > MAX_PROGRAMS_PER_GAUGE) truncated = true;
    for (let id = count; id >= 1 && id > count - MAX_PROGRAMS_PER_GAUGE; id--) programs.push({ manager: m, id: BigInt(id) });
  });
  const progRes = programs.length
    ? await client.multicall({
        allowFailure: true,
        contracts: programs.flatMap((p) => [
          { address: p.manager, abi: rewardsManagerAbi, functionName: "earnedIncentives" as const, args: [tokenId, p.id, MAX_CHECKPOINTS] as const },
          { address: p.manager, abi: rewardsManagerAbi, functionName: "incentive" as const, args: [p.id] as const },
        ]),
      })
    : [];
  const incentives: Array<{ token: Address; amount: bigint }> = [];
  for (let i = 0; i < programs.length; i++) {
    const earned = progRes[i * 2];
    const prog = progRes[i * 2 + 1];
    if (earned?.status !== "success" || prog?.status !== "success") continue;
    const amount = earned.result as bigint;
    if (amount > 0n) incentives.push({ token: (prog.result as { token: Address }).token, amount });
  }
  const tokens = [...new Set([...fees, ...incentives].filter((p) => p.amount > 0n).map((p) => p.token.toLowerCase()))] as Address[];
  const meta = new Map<string, TokenMeta>();
  if (tokens.length) {
    const metaRes = await client.multicall({
      allowFailure: true,
      contracts: tokens.flatMap((t) => [
        { address: t, abi: erc20MetaAbi, functionName: "decimals" as const },
        { address: t, abi: erc20MetaAbi, functionName: "symbol" as const },
      ]),
    });
    tokens.forEach((t, i) => {
      const d = metaRes[i * 2];
      const s = metaRes[i * 2 + 1];
      if (d.status === "success") meta.set(t, { decimals: Number(d.result), symbol: s.status === "success" ? String(s.result) : "token" });
    });
  }
  const prices = tokens.length ? await pricesFor(cfg.id, tokens, fetchFn) : {};
  return { chain: chainTotal(cfg.id, cfg.name, summariseAmounts(fees, meta, prices), summariseAmounts(incentives, meta, prices)), truncated };
}

/** Every chain at once; a chain whose node fails is named in `skipped` instead of failing the whole read. */
export async function readEarnedAll(tokenId: bigint, opts: { chains?: AeroChain[]; client?: (cfg: AeroChain) => Promise<PublicClient>; fetchFn?: typeof fetch } = {}): Promise<EarnedAll> {
  const chains = opts.chains ?? AERO_CHAINS;
  const skipped: string[] = [];
  const results = await Promise.all(
    chains.map(async (cfg) => {
      try {
        return await readEarnedChain(cfg, tokenId, await (opts.client ?? clientFor)(cfg), opts.fetchFn);
      } catch {
        skipped.push(cfg.name);
        return null;
      }
    }),
  );
  const ok = results.filter((r): r is NonNullable<typeof r> => !!r);
  return combineChains(
    ok.map((r) => r.chain),
    skipped,
    ok.some((r) => r.truncated),
  );
}
