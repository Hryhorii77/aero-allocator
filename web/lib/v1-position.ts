import { NextResponse, type NextRequest } from "next/server";
import { isAddress } from "viem";
import { badRequest, parseTokenId } from "./v1-input";
import { BASE_CHAIN } from "./aero-chains";
import { getGaugeFees } from "./gauge-fees-read";
import { aprPct } from "./gauge-yield";
import { gaugeLabel, getGauges } from "./gauges";
import { analysePosition, SWITCH_MIN_GAIN_PCT, SWITCH_MIN_GAIN_USD_PER_DAY, type Analysis } from "./position-advice";
import { readCooldownSec, readCurrentGauges, readOwnerTokenIds, readPosition, MAX_OWNER_POSITIONS, type ServerPosition } from "./position-server";
import { logX402Usage } from "./x402-usage";

export const POSITION_PRICE_USD = 0.05;

const iso = (sec: number | null) => (sec && sec > 0 ? new Date(sec * 1000).toISOString() : null);

export function describePosition(p: ServerPosition, a: Analysis, aeroUsd: number | null) {
  const ratio = (raw: bigint) => Number(raw) / 1e18;
  const apr = (usd: number | null) => (usd === null ? null : aprPct(usd, a.power, aeroUsd));
  return {
    tokenId: p.tokenId.toString(),
    owner: p.owner,
    votingPower: p.votingPower,
    staked: p.staked,
    permanent: p.isPermanent,
    lockEndsAt: p.isPermanent ? null : iso(p.endSec),
    idlePower: ratio(p.parkedRaw),
    onBasePower: ratio(p.onBaseRaw),
    cooldown: a.cooldown.ready
      ? { ready: true, readyAt: null, secondsLeft: 0 }
      : { ready: false, readyAt: iso(a.cooldown.readyAtSec), secondsLeft: a.cooldown.secondsLeft },
    currentGauges: a.current.map((c) => ({ gauge: c.gauge, symbol: c.symbol, pct: c.pct })),
    currentUsdPerDay: a.currentUsdPerDay,
    currentAprPct: apr(a.currentUsdPerDay),
    unpricedGauges: a.unmeasured,
    bestSplit: a.best && {
      usdPerDay: a.best.usdPerDay,
      aprPct: apr(a.best.usdPerDay),
      parts: a.best.parts.map((x) => ({ gauge: x.gauge, symbol: x.symbol, pct: x.pct, usdPerDay: x.usdPerDay })),
    },
    gainUsdPerDay: a.gainUsdPerDay,
    advice: { action: a.advice.action, reason: a.advice.reason, canActNow: a.advice.canActNow, readyAt: iso(a.advice.readyAtSec) },
    confidence: a.confidence,
    feeHistoryHours: a.windowHours,
  };
}

/**
 * Where an sAERO position stands: its power, lock, how much is idle or on Base gauges, when it can next be re-allocated, what it earns
 * now against the best split of Base gauges for its own size (its own power taken out of each gauge first), and whether to stay,
 * switch or allocate. Keyed to a caller's own position, so it is an answer the free gauge ranking can't give.
 */
export async function handlePosition(req: NextRequest): Promise<NextResponse> {
  const q = req.nextUrl.searchParams;
  const tokenParam = q.get("tokenId");
  const addressParam = q.get("address");
  if ((tokenParam === null) === (addressParam === null)) return badRequest("Pass exactly one of ?tokenId=<sAERO position id> or ?address=0x… (a wallet holding sAERO positions).");

  let positions: ServerPosition[];
  let truncated: { total: number; returned: number } | undefined;
  if (tokenParam !== null) {
    const id = parseTokenId(tokenParam);
    if (id === null) return badRequest("tokenId must be a whole number.");
    const p = await readPosition(id);
    if (!p) return NextResponse.json({ error: `No sAERO position #${id} exists.` }, { status: 404 });
    positions = [p];
  } else {
    if (!isAddress(addressParam!)) return badRequest("address must be a 0x… wallet address.");
    const found = await readOwnerTokenIds(addressParam!);
    if (found.tokenIds.length === 0) return NextResponse.json({ error: `${found.owner} holds no sAERO positions.` }, { status: 404 });
    positions = (await Promise.all(found.tokenIds.map(readPosition))).filter((p): p is ServerPosition => p !== null);
    if (found.total > found.tokenIds.length) truncated = { total: found.total, returned: found.tokenIds.length };
  }

  const [gauges, fees, cooldownSec] = await Promise.all([getGauges(BASE_CHAIN.id), getGaugeFees(BASE_CHAIN.id), readCooldownSec()]);
  const symbolOf = (a: string) => {
    const g = gauges.gauges.find((x) => x.gauge.toLowerCase() === a.toLowerCase());
    return g ? gaugeLabel(g) : `${a.slice(0, 6)}…`;
  };
  const nowSec = Math.floor(Date.now() / 1000);
  const out = await Promise.all(
    positions.map(async (p) => {
      const current = await readCurrentGauges(p.tokenId, symbolOf);
      return describePosition(p, analysePosition({ position: p, current, gauges, fees, cooldownSec, nowSec }), fees.aeroUsd ?? null);
    }),
  );
  logX402Usage("v1/position", POSITION_PRICE_USD, { positions: out.length });
  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    chainId: BASE_CHAIN.id,
    cooldownSeconds: cooldownSec,
    feesReadAt: fees.generatedAt ? new Date(fees.generatedAt).toISOString() : null,
    aeroUsd: fees.aeroUsd ?? null,
    positions: out,
    ...(truncated && { truncated: { ...truncated, note: `Only the first ${MAX_OWNER_POSITIONS} positions are analysed; pass ?tokenId= for the rest.` } }),
    basis:
      "Estimates, not guarantees. USD/day = (fees + incentives per day) x your share of a gauge's weight after joining it, with your own " +
      "power taken out of each gauge's weight first. Fees are the recent pace measured from on-chain fee releases (see feeHistoryHours and " +
      `confidence). A switch is advised only when it beats staying by at least ${SWITCH_MIN_GAIN_PCT}% and $${SWITCH_MIN_GAIN_USD_PER_DAY.toFixed(2)}/day, ` +
      "because every allocation restarts a 47-hour wait. Amounts are voting power, as Aero shows them.",
  });
}
