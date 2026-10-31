import { NextResponse } from "next/server";
import { AERO_CHAINS, BASE_CHAIN } from "@/lib/aero-chains";
import { MAX_AMOUNT, roundAmount } from "@/lib/amount";
import { withApiErrorHandling } from "@/lib/api-error";
import { getGaugeFees } from "@/lib/gauge-fees-read";
import { getGauges } from "@/lib/gauges";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { DEFAULT_LIMIT, MAX_LIMIT, topGauges, topGaugesAllChains, type ChainInput } from "@/lib/top-gauges";

export const maxDuration = 60;

const FEE_CHAIN_IDS = AERO_CHAINS.filter((c) => c.feeLogs).map((c) => c.id);

/**
 * Read-only: the gauges on a chain ranked by what an amount of sAERO would earn per day in each, with the same pace, steadiness and
 * incentive-end labels as the page. `chain=all` is the page's "All networks" table: every chain ranked against its own fees and merged,
 * with each row's `chainId` (the ETH to reach a chain other than Base is not counted; all-chains-split weighs it). The amount is rounded to three figures (so nearby amounts share one cached answer). Nothing here
 * sends or signs, and no address is involved.
 */
export const GET = withApiErrorHandling("top-gauges", async (req: Request) => {
  const rl = checkRateLimit(req, { key: "top-gauges", limit: 20, windowMs: 60_000 });
  if (!rl.allowed) return rateLimitResponse(rl.retryAfterSec);
  const q = new URL(req.url).searchParams;
  const amount = Number(q.get("amount"));
  if (!(amount > 0) || amount > MAX_AMOUNT) return NextResponse.json({ error: "amount must be above 0 and at most 1,000,000,000" }, { status: 400 });
  const rawChain = q.get("chain");
  const all = rawChain === "all";
  const chainId = rawChain === null ? BASE_CHAIN.id : Number(rawChain);
  if (!all && !FEE_CHAIN_IDS.includes(chainId)) return NextResponse.json({ error: "fee pace is not measured on this chain", supported: [...FEE_CHAIN_IDS, "all"] }, { status: 400 });
  const rawLimit = q.get("limit");
  const limit = rawLimit === null ? DEFAULT_LIMIT : Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) return NextResponse.json({ error: `limit must be a whole number from 1 to ${MAX_LIMIT}` }, { status: 400 });
  if (all) {
    const read = await Promise.allSettled(FEE_CHAIN_IDS.map((id) => Promise.all([getGauges(id), getGaugeFees(id)])));
    const chains: ChainInput[] = [];
    const skipped: number[] = [];
    read.forEach((r, i) => {
      const id = FEE_CHAIN_IDS[i];
      if (r.status === "fulfilled") chains.push({ chainId: id, gauges: r.value[0].gauges, fees: r.value[1], cooldownSec: id === BASE_CHAIN.id ? r.value[0].cooldownSec : undefined });
      else skipped.push(id);
    });
    if (chains.length === 0) return NextResponse.json({ error: "no chain could be read right now" }, { status: 503 });
    const out = topGaugesAllChains(chains, skipped, roundAmount(amount), limit, Math.floor(Date.now() / 1000), BASE_CHAIN.id);
    return NextResponse.json(out, { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" } });
  }
  const [list, fees] = await Promise.all([getGauges(chainId), getGaugeFees(chainId)]);
  const out = topGauges(chainId, list.gauges, fees, roundAmount(amount), limit, chainId === BASE_CHAIN.id ? list.cooldownSec : undefined, Math.floor(Date.now() / 1000));
  return NextResponse.json(out, { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" } });
});
