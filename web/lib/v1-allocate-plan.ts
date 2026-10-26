import { NextResponse, type NextRequest } from "next/server";
import { formatUnits } from "viem";
import { AllocateError, encodeAllocate, planAllocation } from "./allocate";
import { simulateAllocate } from "./allocate-sim";
import { BASE_CHAIN } from "./aero-chains";
import { getGaugeFees } from "./gauge-fees-read";
import { gaugeLabel, getGauges } from "./gauges";
import { analysePosition } from "./position-advice";
import { readCooldownSec, readCurrentGauges, readPosition } from "./position-server";
import { badRequest, parseTokenId } from "./v1-input";
import { logX402Usage } from "./x402-usage";

export const ALLOCATE_PLAN_PRICE_USD = 0.1;
const MAX_PLAN_GAUGES = 6;

const iso = (sec: number | null) => (sec && sec > 0 ? new Date(sec * 1000).toISOString() : null);

/**
 * The unsigned `allocate()` transaction that puts a position's whole Base amount into the best split of Base gauges for its own size,
 * already simulated against Base's current state as the owner. We never sign or send: the agent signs with the owner's wallet (or an
 * operator Aero accepts). Building a valid call is the hard part (the gauge list overwrites everything on the chain, must add up to the
 * chain total exactly, in ascending address order, with idle power as the zero-address entry), which is what this returns ready-made.
 * Base only: sending power to other chains is not offered.
 */
export async function handleAllocatePlan(req: NextRequest): Promise<NextResponse> {
  const q = req.nextUrl.searchParams;
  const tokenRaw = q.get("tokenId");
  if (tokenRaw === null) return badRequest("Pass ?tokenId=<sAERO position id>.");
  const tokenId = parseTokenId(tokenRaw);
  if (tokenId === null) return badRequest("tokenId must be a whole number.");
  const maxRaw = q.get("maxGauges");
  const maxGauges = maxRaw === null ? MAX_PLAN_GAUGES : Number(maxRaw);
  if (!Number.isInteger(maxGauges) || maxGauges < 1 || maxGauges > MAX_PLAN_GAUGES) return badRequest(`maxGauges must be a whole number from 1 to ${MAX_PLAN_GAUGES}.`);

  const position = await readPosition(tokenId);
  if (!position) return NextResponse.json({ error: `No sAERO position #${tokenId} exists.` }, { status: 404 });

  const [gauges, fees, cooldownSec] = await Promise.all([getGauges(BASE_CHAIN.id), getGaugeFees(BASE_CHAIN.id), readCooldownSec()]);
  const symbolOf = (a: string) => {
    const g = gauges.gauges.find((x) => x.gauge.toLowerCase() === a.toLowerCase());
    return g ? gaugeLabel(g) : `${a.slice(0, 6)}…`;
  };
  const current = await readCurrentGauges(tokenId, symbolOf);
  const analysis = analysePosition({ position, current, gauges, fees, cooldownSec, nowSec: Math.floor(Date.now() / 1000), maxGauges });
  if (!analysis.best) return NextResponse.json({ error: "No Base gauge has a measurable fee pace right now, so there is no split to plan." }, { status: 422 });

  let plan;
  try {
    plan = planAllocation({ tokenId, parked: position.parkedRaw, onBase: position.onBaseRaw, picks: analysis.best.parts.map((p) => ({ gauge: p.gauge, pct: p.pct })) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof AllocateError ? e.message : "Could not build the allocation." }, { status: 422 });
  }
  const tx = encodeAllocate(plan, position.owner);
  const simulation = await simulateAllocate(plan, position.owner);

  const warnings: string[] = [];
  if (!simulation.ok) warnings.push(`Simulation failed: ${simulation.reason}.`);
  if (!analysis.cooldown.ready) warnings.push(`The ${analysis.cooldownHours}-hour wait ends ${iso(analysis.cooldown.readyAtSec)}; the call is rejected until then.`);
  if (analysis.advice.action === "stay") warnings.push(`This position already earns about as much as the best split; sending this restarts the ${analysis.cooldownHours}-hour wait for little gain.`);
  if (analysis.confidence === "thin") warnings.push("The fee pace behind this split rests on under 6 hours of history, so it can move a lot.");

  const chainTotal = plan.chainTotal;
  const bySymbol = new Map(analysis.best.parts.map((p) => [p.gauge.toLowerCase(), p]));
  logX402Usage("v1/allocate-plan", ALLOCATE_PLAN_PRICE_USD, { tokenId: tokenId.toString(), simulationOk: simulation.ok ? 1 : 0 });
  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    tokenId: tokenId.toString(),
    owner: position.owner,
    sendFrom: position.owner,
    transaction: { chainId: BASE_CHAIN.id, to: tx.to, data: tx.data, value: "0" },
    simulation,
    cooldown: analysis.cooldown.ready ? { ready: true, readyAt: null } : { ready: false, readyAt: iso(analysis.cooldown.readyAtSec) },
    picks: plan.gauges
      .filter((g) => bySymbol.has(g.gauge.toLowerCase()))
      .map((g) => {
        const part = bySymbol.get(g.gauge.toLowerCase())!;
        return { gauge: g.gauge, symbol: part.symbol, pct: part.pct, allocated: g.allocated.toString(), allocatedTokens: formatUnits(g.allocated, 18), usdPerDay: part.usdPerDay };
      }),
    idleKeptOnBase: plan.idle.toString(),
    movesFromIdle: plan.delta.toString(),
    baseTotal: chainTotal.toString(),
    expectedUsdPerDay: analysis.best.usdPerDay,
    currentUsdPerDay: analysis.currentUsdPerDay,
    gainUsdPerDay: analysis.gainUsdPerDay,
    advice: { action: analysis.advice.action, reason: analysis.advice.reason },
    confidence: analysis.confidence,
    feeHistoryHours: analysis.windowHours,
    warnings,
    notes: [
      "Unsigned: sign and send `transaction` from `sendFrom` on Base. Nothing here holds keys or sends anything.",
      `allocate() replaces the position's whole Base distribution and starts a new ${analysis.cooldownHours}-hour wait before the next change.`,
      "Amounts are in base units (18 decimals); the split is sized for the position's voting power. Estimates, not guarantees.",
      "Base only. Sending power to other chains is not offered.",
    ],
  });
}
