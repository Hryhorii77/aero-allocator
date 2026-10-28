import { formatEther } from "viem";
import { getPrices } from "aero-allocator/prices";
import { AERO_CHAINS, BASE_CHAIN } from "./aero-chains";
import { bestAcrossChains, type AcrossChains, type ChainBook } from "./all-chains-split";
import { modelFeeWei, quoteCostModel, quoteCrossChain, type CrossChainCostModel } from "./allocate-fee";
import { getGaugeFees } from "./gauge-fees-read";
import { gaugeLabel, getGauges } from "./gauges";
import { rankByUsdPerDay } from "./gauge-yield";
import { DEFAULT_COOLDOWN_SEC } from "./saero";

const WETH_BASE = "0x4200000000000000000000000000000000000006";

export interface AllChainsSplit {
  amount: number;
  /** The horizon the fees are weighed against, in days. */
  days: number;
  ethUsd: number | null;
  /** Oldest fee read among the chains used, ms. */
  generatedAt: number;
  best: AcrossChains;
  baseOnly: AcrossChains | null;
  /** Chains left out because their gauges, fee record or cross-chain fee could not be read just now. */
  skipped: string[];
}

/**
 * The best split of an amount over every Aero chain, net of the ETH each extra chain costs to reach. Reads the same gauge and fee
 * reads as the per-chain page; a chain that fails to read is left out and named. Null when nothing can be ranked or ETH can't be priced
 * (without a price the fees can't be weighed, so no cross-chain answer is given rather than a guessed one).
 */
export async function readAllChainsSplit(amount: number, days?: number): Promise<AllChainsSplit | null> {
  const skipped: string[] = [];
  const settled = await Promise.all(
    AERO_CHAINS.filter((c) => c.feeLogs).map(async (c) => {
      try {
        const [list, fees] = await Promise.all([getGauges(c.id), getGaugeFees(c.id)]);
        const model: CrossChainCostModel | null = c.id === BASE_CHAIN.id ? null : await quoteCostModel(c.id);
        return { c, list, fees, model };
      } catch {
        skipped.push(c.name);
        return null;
      }
    }),
  );
  const ok = settled.filter((x): x is NonNullable<typeof x> => !!x);
  const baseList = ok.find((x) => x.c.id === BASE_CHAIN.id)?.list;
  const horizon = days ?? (baseList?.cooldownSec ?? DEFAULT_COOLDOWN_SEC) / 86_400;

  const prices = await getPrices([WETH_BASE]).catch(() => null);
  const ethUsd = prices?.get(WETH_BASE)?.priceUsd ?? prices?.get(WETH_BASE.toLowerCase())?.priceUsd ?? null;
  const usable = ethUsd && ethUsd > 0 ? ok : ok.filter((x) => x.c.id === BASE_CHAIN.id);
  if (!(ethUsd && ethUsd > 0)) for (const x of ok) if (x.c.id !== BASE_CHAIN.id) skipped.push(x.c.name);

  const books: ChainBook[] = usable.map((x) => ({
    chainId: x.c.id,
    name: x.c.name,
    rows: rankByUsdPerDay(x.list.gauges, x.fees.fees, amount).map((r) => ({
      gauge: r.gauge,
      symbol: gaugeLabel(r),
      feesUsdPerDay: r.feesUsdPerDay,
      incentivesUsdPerDay: r.incentivesUsdPerDay,
      weight: r.weight,
      windowHours: r.windowHours,
      ...(r.spike ? { spike: r.spike } : {}),
    })),
  }));
  const models = new Map(usable.flatMap((x) => (x.model ? [[x.c.id, x.model] as const] : [])));
  const feeUsd = (chainId: number, gauges: number) => {
    const m = models.get(chainId);
    return m && ethUsd ? Number(formatEther(modelFeeWei(m, gauges))) * ethUsd : Infinity;
  };
  const result = bestAcrossChains(books, amount, horizon, feeUsd);
  if (!result) return null;

  // The comparison used a straight-line fee; the answer shown re-quotes each chain it uses exactly.
  const requote = async (r: AcrossChains): Promise<AcrossChains> => {
    const chains = await Promise.all(
      r.chains.map(async (c) => {
        if (c.chainId === BASE_CHAIN.id || !ethUsd) return c;
        const q = await quoteCrossChain(c.chainId, c.parts.length).catch(() => null);
        return q ? { ...c, feeUsd: Number(formatEther(BigInt(q.total))) * ethUsd } : c;
      }),
    );
    const fee = chains.reduce((s, c) => s + c.feeUsd, 0);
    return { ...r, chains, feeUsd: fee, netUsd: r.usdPerDay * horizon - fee };
  };
  const best = await requote(result.best);
  const used = new Set(best.chains.map((c) => c.chainId));
  const generatedAt = Math.min(...usable.filter((x) => used.has(x.c.id)).map((x) => x.fees.generatedAt).filter((t) => t > 0), Date.now());
  return { amount, days: horizon, ethUsd, generatedAt, best, baseOnly: result.baseOnly, skipped };
}
