import type { GaugeList } from "./gauges";
import { gaugeLabel } from "./gauges";
import type { GaugeFees } from "./gauge-fees-read";
import { paceConfidence, rankByUsdPerDay } from "./gauge-yield";
import { cooldownState, type CooldownState, type SaeroPosition } from "./saero";
import { bestSplit, currentUsdPerDay, type Split } from "./split";

/** Where a position sits on Base now: a gauge and its share (0-100) of the amount booked on Base. */
export interface CurrentGauge {
  gauge: string;
  symbol: string;
  pct: number;
}

/** A move must beat staying by this much (both) before it is called worth the 47-hour wait that follows any allocation. */
export const SWITCH_MIN_GAIN_PCT = 5;
export const SWITCH_MIN_GAIN_USD_PER_DAY = 0.05;

export type Action = "stay" | "switch" | "allocate" | "none" | "unknown";

export interface Advice {
  action: Action;
  /** Plain words for a person or an agent's log. */
  reason: string;
  /** True when the 47-hour wait is over (or the position was never allocated), so the move can be sent now. */
  canActNow: boolean;
  readyAtSec: number | null;
}

export interface Analysis {
  /** Power the figures are sized for, whole tokens. */
  power: number;
  cooldown: CooldownState;
  current: CurrentGauge[];
  /** USD/day where it sits now; null when none of its current gauges can be priced. */
  currentUsdPerDay: number | null;
  /** Current gauges with no fee estimate, so not in the figure above. */
  unmeasured: string[];
  best: Split | null;
  /** Best split minus staying, USD/day; null when either side is missing. */
  gainUsdPerDay: number | null;
  advice: Advice;
  /** Hours of fee history behind the weakest gauge the best split uses (0 when there is none). */
  windowHours: number;
  confidence: "thin" | "fair" | "solid" | null;
}

/** True when the best split beats staying by enough dollars and, where staying earns something, enough percent. */
function worthSwitching(gainUsd: number, nowUsd: number): boolean {
  if (gainUsd < SWITCH_MIN_GAIN_USD_PER_DAY) return false;
  return nowUsd > 0 ? (gainUsd / nowUsd) * 100 >= SWITCH_MIN_GAIN_PCT : true;
}

/**
 * What a position earns where it is versus the best split of Base gauges, and what to do about it. The position's own power is
 * already in each gauge's weight today, so it is taken out before ranking (the same step the page takes). Amounts are voting power,
 * as Aero shows them.
 */
export function analysePosition(args: {
  position: Pick<SaeroPosition, "votingPower" | "staked" | "parkedRaw" | "onBaseRaw" | "lastAllocatedSec">;
  current: CurrentGauge[];
  gauges: GaugeList;
  fees: GaugeFees;
  cooldownSec: number;
  nowSec: number;
  maxGauges?: number;
}): Analysis {
  const { position, current, gauges: list, fees, cooldownSec, nowSec } = args;
  const power = position.votingPower > 0 ? position.votingPower : position.staked;
  const cooldown = cooldownState(position.lastAllocatedSec, cooldownSec, nowSec);
  const canActNow = cooldown.ready;
  const readyAtSec = cooldown.ready ? null : cooldown.readyAtSec;

  const own = new Map(current.map((c) => [c.gauge.toLowerCase(), (c.pct / 100) * power]));
  const gauges = list.gauges.map((g) => ({ ...g, weight: Math.max(0, g.weight - (own.get(g.gauge.toLowerCase()) ?? 0)) }));
  const ranked = rankByUsdPerDay(gauges, fees.fees, power);
  const best = bestSplit(
    ranked.map((r) => ({ gauge: r.gauge, symbol: gaugeLabel(r), rate: r.feesUsdPerDay + r.incentivesUsdPerDay, weight: r.weight })),
    power,
    args.maxGauges ?? 6,
  );

  let nowUsd: number | null = null;
  let unmeasured: string[] = [];
  if (current.length > 0) {
    // A gauge you're on can fall under the ranking's minimum weight once you leave it; price it from its raw row instead.
    const priced = rankByUsdPerDay(gauges, fees.fees, power, 0);
    const now = currentUsdPerDay(priced, current, power);
    unmeasured = now.unmeasured;
    nowUsd = now.unmeasured.length === current.length ? null : now.usd;
  }
  const gain = best && nowUsd !== null ? best.usdPerDay - nowUsd : null;

  const byGauge = new Map(ranked.map((r) => [r.gauge.toLowerCase(), r]));
  const weakest = best ? best.parts.reduce((h, p) => Math.min(h, byGauge.get(p.gauge.toLowerCase())?.windowHours ?? 0), Infinity) : 0;
  const windowHours = best ? weakest : 0;

  const total = position.parkedRaw + position.onBaseRaw;
  let advice: Advice;
  if (total <= 0n || !(power > 0)) {
    advice = { action: "none", reason: "This position has no power to allocate. If it was deposited into an Aero Autopilot, the NFT is only the key to withdraw it; manage it on Aero.", canActNow: false, readyAtSec: null };
  } else if (!best) {
    advice = { action: "unknown", reason: "No gauge on Base has a measurable fee pace yet, so there is nothing to rank.", canActNow, readyAtSec };
  } else if (position.onBaseRaw === 0n) {
    advice = { action: "allocate", reason: "This position's power is idle, so it earns nothing until it is allocated.", canActNow, readyAtSec };
  } else if (nowUsd === null || gain === null) {
    advice = { action: "unknown", reason: "None of this position's current gauges has a fee estimate, so staying can't be priced.", canActNow, readyAtSec };
  } else if (worthSwitching(gain, nowUsd) && windowHours < 6) {
    advice = {
      action: "unknown",
      reason: `The best split looks about $${gain.toFixed(2)}/day better, but it rests on under 6 hours of fee history, too thin to recommend moving (every allocation restarts a 47-hour wait).`,
      canActNow,
      readyAtSec,
    };
  } else if (worthSwitching(gain, nowUsd)) {
    advice = { action: "switch", reason: `The best split earns about $${gain.toFixed(2)}/day more than where it sits.`, canActNow, readyAtSec };
  } else {
    advice = { action: "stay", reason: "Moving would not earn enough more to be worth the 47-hour wait that follows an allocation.", canActNow, readyAtSec };
  }

  return { power, cooldown, current, currentUsdPerDay: nowUsd, unmeasured, best, gainUsdPerDay: gain, advice, windowHours, confidence: best ? paceConfidence(windowHours) : null };
}
