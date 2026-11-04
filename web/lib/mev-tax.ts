import { parseAbi, type Address, type PublicClient } from "viem";

// Aero's MEV tax (dromos-labs/metadex-public V3/src/fees/PriorityFeeMevTaxModule.sol): a swap that pays a priority fee above an
// adaptive "retail" threshold pays extra, up to 10%, and that extra goes to the pool's fees. A concentrated pool asks its swap hook
// (CLFactory.getPoolSwapHook(pool), metadex-slipstream-public) and the hook asks its `mevTaxModule()`; a classic pool asks its factory's
// `mevTaxModule()`. A module with `priorityFeeMultiplier` 0 computes a zero tax, so only a non-zero multiplier counts as switched on.
// Read 2026-11-04: on OP every Slipstream pool's hook has a live module (multiplier 5,000,000); Base, Arbitrum, Ink and Arc have modules
// with multiplier 0, Ethereum and Robinhood Chain none, and the classic pool factories none anywhere checked.

const poolAbi = parseAbi(["function factory() view returns (address)"]);
const clFactoryAbi = parseAbi(["function getPoolSwapHook(address) view returns (address)"]);
const withModuleAbi = parseAbi(["function mevTaxModule() view returns (address)"]);
const moduleAbi = parseAbi(["function priorityFeeMultiplier() view returns (uint64)"]);

const ZERO = /^0x0+$/;
const ok = (r: { status: string; result?: unknown }) => (r.status === "success" && typeof r.result === "string" && !ZERO.test(r.result) ? (r.result as Address) : null);

/**
 * Which of these pools charge an MEV tax now, as a set of lowercase pool addresses. Any read that fails leaves its pools untagged
 * (never throws), so a node hiccup only hides the tag.
 */
export async function readMevTaxedPools(c: Pick<PublicClient, "multicall">, pools: Array<{ pool: Address; concentrated: boolean }>): Promise<Set<string>> {
  const out = new Set<string>();
  if (pools.length === 0) return out;
  try {
    const factories = await c.multicall({ allowFailure: true, contracts: pools.map((p) => ({ address: p.pool, abi: poolAbi, functionName: "factory" as const })) });
    // What each pool asks for its tax: the hook for a concentrated pool, the factory itself for a classic one.
    const askIdx = pools.map((p, i) => (p.concentrated ? i : -1)).filter((i) => i >= 0 && ok(factories[i]));
    const hooks = await c.multicall({
      allowFailure: true,
      contracts: askIdx.map((i) => ({ address: ok(factories[i])!, abi: clFactoryAbi, functionName: "getPoolSwapHook" as const, args: [pools[i].pool] as const })),
    });
    const asker = new Map<number, Address>();
    askIdx.forEach((i, k) => {
      const h = ok(hooks[k]);
      if (h) asker.set(i, h);
    });
    pools.forEach((p, i) => {
      const f = ok(factories[i]);
      if (!p.concentrated && f) asker.set(i, f);
    });
    const askers = [...new Set([...asker.values()].map((a) => a.toLowerCase()))] as Address[];
    const mods = await c.multicall({ allowFailure: true, contracts: askers.map((a) => ({ address: a, abi: withModuleAbi, functionName: "mevTaxModule" as const })) });
    const moduleOf = new Map<string, Address | null>(askers.map((a, k) => [a, ok(mods[k])]));
    const modules = [...new Set([...moduleOf.values()].filter((m): m is Address => !!m).map((m) => m.toLowerCase()))] as Address[];
    const mults = await c.multicall({ allowFailure: true, contracts: modules.map((m) => ({ address: m, abi: moduleAbi, functionName: "priorityFeeMultiplier" as const })) });
    const live = new Set<string>(modules.filter((_, k) => mults[k].status === "success" && (mults[k].result as bigint) > 0n));
    for (const [i, a] of asker) {
      const m = moduleOf.get(a.toLowerCase());
      if (m && live.has(m.toLowerCase())) out.add(pools[i].pool.toLowerCase());
    }
  } catch {
    // leave everything untagged
  }
  return out;
}
