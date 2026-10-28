import { NextResponse, type NextRequest } from "next/server";
import { encodeFunctionData, formatEther, formatUnits } from "viem";
import { AERO_CHAINS, BASE_CHAIN } from "./aero-chains";
import { allocateAbi, AllocateError } from "./allocate";
import { quoteCostModel, type CrossChainCostModel } from "./allocate-fee";
import { planAcrossChains, withMargin, type AllocateStep, type CurrentChain } from "./allocate-multichain";
import { simulateStep, type Simulation } from "./allocate-sim";
import { readAllChainsSplit } from "./all-chains-read";
import type { ChainBook, ChainShare } from "./all-chains-split";
import { customChainSplit, percentToHundredths } from "./custom-chain-split";
import { getGaugeFees } from "./gauge-fees-read";
import { rankByUsdPerDay } from "./gauge-yield";
import { gaugeLabel, getGauges } from "./gauges";
import { readLeafChain, type LeafChainState } from "./leaf-read";
import { readCooldownSec, readCurrentGauges, readOtherChainAmounts, readPosition } from "./position-server";
import { cooldownState, formatDuration, SAERO } from "./saero";
import { badRequest, parseTokenId } from "./v1-input";
import { logX402Usage } from "./x402-usage";

export const CROSS_CHAIN_PLAN_PRICE_USD = 0.25;

const iso = (sec: number) => new Date(sec * 1000).toISOString();
const OTHER_CHAINS = AERO_CHAINS.filter((c) => c.id !== BASE_CHAIN.id && c.feeLogs);

/** `chains=5042:30,10:20.5`: a percentage of the position for each chain other than Base (Base keeps the rest). An error text on anything else. */
export function parseChainsParam(raw: string): { shares: Array<{ chainId: number; name: string; hundredths: number }> } | { error: string } {
  if (raw.trim() === "") return { error: "chains is empty. Pass e.g. ?chains=5042:30,10:20, or leave it out for the best split." };
  const shares: Array<{ chainId: number; name: string; hundredths: number }> = [];
  for (const part of raw.split(",")) {
    const m = /^(\d{1,10}):(.+)$/.exec(part.trim());
    if (!m) return { error: `"${part}" is not <chainId>:<percent>, e.g. 5042:30.` };
    const chain = OTHER_CHAINS.find((c) => c.id === Number(m[1]));
    if (!chain) return { error: `Chain ${m[1]} is not one of ${OTHER_CHAINS.map((c) => `${c.id} ${c.name}`).join(", ")}. Base keeps whatever is left, so it is not listed.` };
    if (shares.some((s) => s.chainId === chain.id)) return { error: `Chain ${chain.id} is listed twice.` };
    const hundredths = percentToHundredths(m[2]);
    if (hundredths === null || hundredths === 0) return { error: `The share for chain ${chain.id} must be a percentage above 0 and at most 100, with at most two decimals.` };
    shares.push({ chainId: chain.id, name: chain.name, hundredths });
  }
  if (shares.reduce((s, x) => s + x.hundredths, 0) > 10_000) return { error: "The shares add up to more than 100%." };
  return { shares };
}

/**
 * The ordered, unsigned `allocate()` transactions that take a position from where it is on every Aero chain to a split over several
 * chains: the best split over all chains by default, or the percentages the caller gives. One transaction when idle power only has to go
 * out, two when a chain's share goes down (return first, send once Aero's message has made the power idle). Never signs or sends. It
 * says what each step is waiting for (each chain has its own wait, and a return from another chain arrives minutes later) and simulates
 * the step that can be sent now as the owner; call again after a step lands, because the plan is built from the chains' current state.
 */
export async function handleCrossChainPlan(req: NextRequest): Promise<NextResponse> {
  const q = req.nextUrl.searchParams;
  const tokenRaw = q.get("tokenId");
  if (tokenRaw === null) return badRequest("Pass ?tokenId=<sAERO position id>.");
  const tokenId = parseTokenId(tokenRaw);
  if (tokenId === null) return badRequest("tokenId must be a whole number.");
  const chainsRaw = q.get("chains");
  const parsed = chainsRaw === null ? null : parseChainsParam(chainsRaw);
  if (parsed && "error" in parsed) return badRequest(parsed.error);
  const daysRaw = q.get("days");
  const days = daysRaw === null ? undefined : Number(daysRaw);
  if (days !== undefined && !(days >= 1 && days <= 90)) return badRequest("days must be a number from 1 to 90.");

  const position = await readPosition(tokenId);
  if (!position) return NextResponse.json({ error: `No sAERO position #${tokenId} exists.` }, { status: 404 });
  const [byChain, cooldownSec, baseGauges] = await Promise.all([readOtherChainAmounts(tokenId), readCooldownSec(), getGauges(BASE_CHAIN.id)]);
  const total = position.parkedRaw + position.onBaseRaw + Object.values(byChain).reduce((a, b) => a + b, 0n);
  if (total <= 0n) return NextResponse.json({ error: "This position has no power to allocate (it may be an Autopilot key or withdrawn)." }, { status: 422 });
  const nowSec = Math.floor(Date.now() / 1000);

  // The proposal: the best split over every chain, or the caller's percentages with the best gauges inside each.
  let chains: ChainShare[];
  let expectedUsdPerDay: number;
  let horizonDays: number | null = null;
  let confidence: string | null = null;
  if (parsed && "shares" in parsed) {
    const baseH = 10_000 - parsed.shares.reduce((s, x) => s + x.hundredths, 0);
    const shares = [{ chainId: BASE_CHAIN.id, name: BASE_CHAIN.name, hundredths: baseH }, ...parsed.shares].filter((x) => x.hundredths > 0);
    const books: ChainBook[] = await Promise.all(
      shares.map(async (sh) => {
        const [g, f] = await Promise.all([getGauges(sh.chainId), getGaugeFees(sh.chainId)]);
        const rows = rankByUsdPerDay(g.gauges, f.fees, (position.votingPower * sh.hundredths) / 10_000);
        return { chainId: sh.chainId, name: sh.name, rows: rows.map((r) => ({ gauge: r.gauge, symbol: gaugeLabel(r), feesUsdPerDay: r.feesUsdPerDay, incentivesUsdPerDay: r.incentivesUsdPerDay, weight: r.weight, windowHours: r.windowHours })) };
      }),
    );
    const res = customChainSplit(shares, position.votingPower, books);
    if ("error" in res) return NextResponse.json({ error: res.error }, { status: 422 });
    chains = res.chains;
    expectedUsdPerDay = res.usdPerDay;
  } else {
    const best = await readAllChainsSplit(position.votingPower, days);
    if (!best) return NextResponse.json({ error: "No gauge on any chain has a measurable fee pace right now, so there is no split to plan." }, { status: 422 });
    chains = best.best.chains;
    expectedUsdPerDay = best.best.usdPerDay;
    horizonDays = best.days;
    confidence = best.best.confidence;
  }

  // What each chain costs to reach (a straight line in gauges, plus the margin) and the position's own state on the chains it touches.
  const involved = [...new Set([...chains.map((c) => c.chainId), ...Object.entries(byChain).filter(([, a]) => a > 0n).map(([id]) => Number(id))])].filter((id) => id !== BASE_CHAIN.id);
  const [modelList, leafList] = await Promise.all([
    Promise.all(involved.map((id) => quoteCostModel(id).catch(() => null))),
    Promise.all(involved.map((id) => readLeafChain(id, tokenId).catch(() => null))),
  ]);
  const missing = involved.find((_, i) => modelList[i] === null);
  if (missing !== undefined) return NextResponse.json({ error: `Could not read what ${AERO_CHAINS.find((c) => c.id === missing)?.name ?? missing} costs to reach right now. Try again in a moment.` }, { status: 503 });
  const models = new Map<number, CrossChainCostModel>(involved.map((id, i) => [id, modelList[i]!]));
  const leaves = new Map<number, LeafChainState | null>(involved.map((id, i) => [id, leafList[i]]));

  const symbolOf = (a: string) => {
    const g = baseGauges.gauges.find((x) => x.gauge.toLowerCase() === a.toLowerCase());
    return g ? gaugeLabel(g) : `${a.slice(0, 6)}…`;
  };
  const currentBase = await readCurrentGauges(tokenId, symbolOf);
  const others: Record<number, CurrentChain> = Object.fromEntries(
    Object.entries(byChain)
      .filter(([, a]) => a > 0n)
      .map(([id, amount]) => {
        const leaf = leaves.get(Number(id));
        return [Number(id), { amount, gauges: leaf && leaf.total > 0n ? leaf.gauges.map((x) => ({ gauge: x.gauge, pct: Number((x.amount * 10_000n) / leaf.total) / 100 })) : [] }];
      }),
  );

  let steps: AllocateStep[];
  try {
    steps = planAcrossChains({
      tokenId,
      parked: position.parkedRaw,
      onBase: position.onBaseRaw,
      currentBase,
      others,
      refundRecipient: position.owner,
      targets: chains.map((c) => ({ chainId: c.chainId, picks: c.parts.map((p) => ({ gauge: p.gauge, bps: Math.round(p.pct * 100) })) })),
      fees: {
        chainStepWei: (id) => withMargin(models.get(id)!.chainStepWei),
        gaugeStepWei: (id, n) => withMargin(models.get(id)!.gaugeBaseWei + models.get(id)!.perGaugeWei * BigInt(n)),
        returnCostWei: (id) => models.get(id)!.returnCostWei,
      },
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof AllocateError ? e.message : "Could not build the allocation." }, { status: 422 });
  }

  /** Why a step can't be sent yet; empty when it can. */
  const blockers = (step: AllocateStep): string[] => {
    const out: string[] = [];
    if (position.parkedRaw < step.needsIdle) {
      // Base returns instantly; a return from any other chain only credits Base when Aero's message arrives.
      const viaMessage = steps.some((x) => x.returns && x.chains.some((c) => c !== BASE_CHAIN.id));
      out.push(`Needs ${formatUnits(step.needsIdle, 18)} idle power; ${formatUnits(position.parkedRaw, 18)} is idle now. ${viaMessage ? "Aero's return message brings it back to Base a few minutes after the return step lands." : "It is idle as soon as the return step confirms (Base is instant)."}`);
    }
    for (const id of step.chains) {
      const name = AERO_CHAINS.find((c) => c.id === id)?.name ?? `chain ${id}`;
      if (id === BASE_CHAIN.id) {
        const left = position.lastAllocatedSec + cooldownSec - nowSec;
        if (left > 0) out.push(`Base is in its ${Math.round(cooldownSec / 3600)}-hour wait until ${iso(position.lastAllocatedSec + cooldownSec)}.`);
        continue;
      }
      const leaf = leaves.get(id);
      if (!leaf) {
        out.push(`${name}'s own node could not be read, so its wait is unknown.`);
        continue;
      }
      if ((byChain[id] ?? 0n) > 0n && leaf.total + leaf.idle !== byChain[id]) out.push(`A change on ${name} is still on its way (the chain and Base disagree about the amount).`);
      const wait = cooldownState(leaf.lastAllocatedSec, leaf.cooldownSec, nowSec);
      if (!wait.ready) out.push(`${name} is in its wait for ${formatDuration(wait.secondsLeft)} (until ${iso(wait.readyAtSec)}).`);
    }
    return out;
  };

  const first = steps[0];
  const blocked = steps.map(blockers);
  const simulation: Simulation | null = await simulateStep(first, position.owner);
  const warnings: string[] = [];
  if (!simulation.ok) warnings.push(`Simulation of step 1 failed: ${simulation.reason}.`);
  if (confidence === "thin") warnings.push("The fee pace behind this split rests on under 6 hours of history, so it can move a lot.");
  if (confidence === "spiky") warnings.push("A gauge in this split is releasing far more fees than usual right now; the estimate counts it at its burst pace.");

  logX402Usage("v1/cross-chain-plan", CROSS_CHAIN_PLAN_PRICE_USD, { tokenId: tokenId.toString(), steps: steps.length, simulationOk: simulation.ok ? 1 : 0, mode: parsed ? 1 : 0 });
  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    tokenId: tokenId.toString(),
    owner: position.owner,
    sendFrom: position.owner,
    mode: parsed ? "chains" : "best",
    horizonDays,
    targets: chains.map((c) => ({
      chainId: c.chainId,
      name: c.name,
      pct: c.pct,
      expectedUsdPerDay: c.usdPerDay,
      gauges: c.parts.map((p) => ({ gauge: p.gauge, symbol: p.symbol, pct: p.pct, usdPerDay: p.usdPerDay })),
    })),
    expectedUsdPerDay,
    confidence,
    steps: steps.map((s, i) => ({
      index: i + 1,
      kind: s.returns ? "return" : "send",
      label: s.label,
      transaction: { chainId: BASE_CHAIN.id, to: SAERO.voter, data: encodeFunctionData({ abi: allocateAbi, functionName: "allocate", args: s.args }), value: s.valueWei.toString() },
      valueEth: formatEther(s.valueWei),
      chains: s.chains,
      needsIdlePower: s.needsIdle.toString(),
      canSendNow: blocked[i].length === 0,
      blockedBy: blocked[i],
      simulation: i === 0 ? simulation : null,
      suggestedGasLimit: i === 0 && simulation.ok && simulation.gasEstimate ? ((BigInt(simulation.gasEstimate) * 130n) / 100n).toString() : null,
    })),
    warnings,
    notes: [
      "Unsigned: sign and send each step's `transaction` from `sendFrom` on Base. Nothing here holds keys or sends anything.",
      "Send the steps in order, each only after the previous one is confirmed (and its `blockedBy` is empty). Call this route again between steps: the plan is built from the chains' current state, and Aero's return message from another chain reaches Base minutes after the transaction.",
      "`value` is ETH in wei, the sum of the cross-chain message fees plus a 10% margin; the unused part is refunded to the owner, except the return fee a chain keeps. Send with a gas limit about 30% above the estimate: a plain estimate can run out of gas at the cross-chain dispatch (seen on a fork of Base).",
      "Only step 1 is simulated: later steps depend on it. Delivery of Aero's messages on the other chains cannot be simulated; power sent to another chain shows as idle there until its gauge message lands, usually a few minutes.",
      "Amounts are in base units (18 decimals). Estimates, not guarantees; not financial advice.",
    ],
    baseWaitHours: Math.round(cooldownSec / 3600),
    power: { idle: position.parkedRaw.toString(), onBase: position.onBaseRaw.toString(), onOtherChains: Object.fromEntries(Object.entries(byChain).filter(([, a]) => a > 0n).map(([id, a]) => [id, a.toString()])) },
  });
}
