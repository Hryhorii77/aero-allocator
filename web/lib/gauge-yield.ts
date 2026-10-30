import type { GaugeRow } from "./gauges";
import type { GaugeFee } from "./gauge-fees-read";
import type { Spike } from "./fee-history";
import { DEFAULT_COOLDOWN_SEC } from "./saero";

/** Gauges lighter than this (whole sAERO power) are not ranked: a few dollars of fees over almost no weight reads as a huge yield and vanishes once you add any size. */
export const MIN_RANK_WEIGHT = 100_000;

export interface YieldRow {
  gauge: GaugeRow["gauge"];
  symbol: string;
  /** Fees to voters, USD/day, at the recent pace. */
  feesUsdPerDay: number;
  /** Incentives streaming now, USD/day. */
  incentivesUsdPerDay: number;
  /** What those incentives average per day over the wait, counting each program only until it ends. Absent when the programs' end times are unknown. */
  incentivesLowUsdPerDay?: number;
  /** When the first and the last of the streaming programs end (unix seconds). Absent when none stream or the end times are unknown. */
  incentivesEnd?: { first: number; last: number };
  /** What `amount` of power would earn per day in this gauge after it joins the weight already there. */
  usdPerDay: number;
  /** Your share of the gauge's weight once you add `amount`, 0-100. */
  sharePct: number;
  /** Power already in the gauge, whole tokens. */
  weight: number;
  /** Pool kind ("CL100", "stable", "volatile"), to tell same-named gauges apart. */
  poolType?: string;
  /** How many hours of fee history the pace rests on. */
  windowHours: number;
  /** How many complete half-days paid at least half the average one; absent until there are three. */
  steady?: { buckets: number; paying: number };
  /** Set when the fee pace is far above the gauge's usual level, with that level. */
  spike?: Spike;
}

/** Yearly return in percent for earning `usdPerDay` on `amount` AERO at `aeroUsd` each; null when the price or amount is missing. */
export function aprPct(usdPerDay: number, amount: number, aeroUsd: number | null | undefined): number | null {
  if (!aeroUsd || !(aeroUsd > 0) || !(amount > 0)) return null;
  return ((usdPerDay * 365) / (amount * aeroUsd)) * 100;
}

/** Hours of fee history below which a pace is "thin", and from which it is "solid". */
export const THIN_UNDER_HOURS = 6;
export const SOLID_FROM_HOURS = 24;

/** How much to trust a fee pace: a few hours of fee releases can swing a lot, a day or more is steadier. */
export function paceConfidence(windowHours: number): "thin" | "fair" | "solid" {
  return windowHours >= SOLID_FROM_HOURS ? "solid" : windowHours >= THIN_UNDER_HOURS ? "fair" : "thin";
}

export type PaceLabel = "thin" | "fair" | "solid" | "spiky";

/** What the pace column says: "spiky" when the pace is a burst far above the gauge's usual level, otherwise how much history it rests on. */
export function paceLabel(y: Pick<YieldRow, "windowHours" | "spike">): PaceLabel {
  return y.spike ? "spiky" : paceConfidence(y.windowHours);
}

/**
 * What a gauge's streaming incentives average per day over the next `windowSec`: each program counts until it ends, then nothing.
 * Aero's incentives stream at a fixed rate but stop when their program does, and a position can't be moved during the wait, so
 * a program that ends halfway through it only pays half of its daily figure over the wait. A program can be renewed; this counts
 * only what is streaming now.
 */
export function incentivesOverWait(
  programs: Array<{ end: number; usdPerDay: number }>,
  nowSec: number,
  windowSec: number,
): { avgUsdPerDay: number; first: number; last: number } | null {
  if (programs.length === 0 || !(windowSec > 0)) return null;
  let avg = 0;
  for (const p of programs) avg += p.usdPerDay * (Math.min(Math.max(0, p.end - nowSec), windowSec) / windowSec);
  return { avgUsdPerDay: avg, first: Math.min(...programs.map((p) => p.end)), last: Math.max(...programs.map((p) => p.end)) };
}

/** Options for ranking: the clock and the wait the low case looks across (the live wait where the caller has it, else the 47 h default). */
export interface RankOptions {
  nowSec?: number;
  waitSec?: number;
}

/**
 * Dollars per day for `amount` of power in each gauge with a fee estimate: (fees + incentives) x amount / (weight + amount).
 * Your own allocation dilutes the gauge, so a small pool does not keep its headline yield as the amount grows.
 */
export function rankByUsdPerDay(
  gauges: GaugeRow[],
  fees: GaugeFee[],
  amount: number,
  minWeight: number = MIN_RANK_WEIGHT,
  opts: RankOptions = {},
): YieldRow[] {
  if (!(amount > 0)) return [];
  const nowSec = opts.nowSec ?? Math.floor(Date.now() / 1000);
  const waitSec = opts.waitSec ?? DEFAULT_COOLDOWN_SEC;
  const feeOf = new Map(fees.map((f) => [f.gauge.toLowerCase(), f]));
  const rows: YieldRow[] = [];
  for (const g of gauges) {
    const fee = feeOf.get(g.gauge.toLowerCase());
    const f = fee?.feesUsdPerDay;
    if (f === undefined || fee === undefined || g.weight < minWeight || !g.activated) continue;
    const incentivesUsdPerDay = g.incentivesUsdPerWeek / 7;
    const share = amount / (g.weight + amount);
    const over = g.incentivePrograms ? incentivesOverWait(g.incentivePrograms, nowSec, waitSec) : null;
    rows.push({
      gauge: g.gauge,
      symbol: g.symbol,
      feesUsdPerDay: f,
      incentivesUsdPerDay,
      ...(over ? { incentivesLowUsdPerDay: Math.min(incentivesUsdPerDay, over.avgUsdPerDay), incentivesEnd: { first: over.first, last: over.last } } : {}),
      usdPerDay: (f + incentivesUsdPerDay) * share,
      sharePct: share * 100,
      weight: g.weight,
      poolType: g.poolType,
      windowHours: fee.windowHours,
      ...(fee.steady ? { steady: fee.steady } : {}),
      ...(fee.spike ? { spike: fee.spike } : {}),
    });
  }
  return rows.sort((a, b) => b.usdPerDay - a.usdPerDay);
}

/** When incentives are at least this share of what a gauge pays, fee steadiness no longer describes its income. */
export const INCENTIVE_DOMINATED_SHARE = 0.5;

/** An incentive-paid gauge is `endsSoon` when part of what it pays stops inside the wait, so its income is not steady across it. */
export type SteadyLabel = { kind: "incentives"; endsSoon?: boolean } | { kind: "fees"; paying: number; buckets: number };

/** True when the streaming incentives average at least 5% less over the wait than they pay now, because programs end inside it. */
export function incentivesEndInWait(y: Pick<YieldRow, "incentivesUsdPerDay" | "incentivesLowUsdPerDay">): boolean {
  return y.incentivesLowUsdPerDay !== undefined && y.incentivesLowUsdPerDay < y.incentivesUsdPerDay * 0.95;
}

/**
 * What the Steady column says for a gauge. Fee releases are lumpy, but incentives stream at a fixed rate until their program ends, so a
 * gauge paid mostly by incentives is steady by construction and its fee record would only mislead. Otherwise it is the fee record's
 * count of paying half-days, or nothing yet. Incentives that end inside the wait are not steady across it, so that gauge says so.
 */
export function steadyLabel(y: Pick<YieldRow, "feesUsdPerDay" | "incentivesUsdPerDay" | "incentivesLowUsdPerDay" | "steady">): SteadyLabel | null {
  const total = y.feesUsdPerDay + y.incentivesUsdPerDay;
  if (total > 0 && y.incentivesUsdPerDay / total >= INCENTIVE_DOMINATED_SHARE) return incentivesEndInWait(y) ? { kind: "incentives", endsSoon: true } : { kind: "incentives" };
  return y.steady ? { kind: "fees", ...y.steady } : null;
}

/** 0-1 for sorting: incentive-paid gauges count as fully steady, the rest by their share of paying half-days, none last. */
export function steadySortScore(y: Pick<YieldRow, "feesUsdPerDay" | "incentivesUsdPerDay" | "incentivesLowUsdPerDay" | "steady">): number {
  const l = steadyLabel(y);
  return !l ? -1 : l.kind === "incentives" ? (l.endsSoon ? 0.5 : 1) : l.paying / l.buckets;
}

const hoursText = (sec: number) => (sec < 3600 ? "under 1 h" : `${Math.round(sec / 3600)} h`);

/**
 * The line under a gauge's name when some of its incentives stop inside the wait: "incentives end in 31 h" when every program does,
 * "some incentives end in 6 h" when only part does. Null when nothing ends inside the wait (or the loss is under 5%), so a gauge
 * whose programs run on shows nothing. A program can be renewed, which the text can't know.
 */
export function incentiveEndText(
  y: Pick<YieldRow, "incentivesUsdPerDay" | "incentivesLowUsdPerDay" | "incentivesEnd">,
  nowSec: number,
  waitSec: number,
): string | null {
  if (!y.incentivesEnd || !incentivesEndInWait(y)) return null;
  const lastIn = y.incentivesEnd.last - nowSec;
  if (lastIn <= waitSec) return `incentives end in ${hoursText(Math.max(0, lastIn))}`;
  return `some incentives end in ${hoursText(Math.max(0, y.incentivesEnd.first - nowSec))}`;
}

/**
 * For the "steadiest only" filter: every complete half-day of the fee record paid (or the gauge is paid by incentives that run past the
 * wait) and the pace is not a burst. A gauge with no record yet is not steady, it is unknown.
 */
export function isSteadiest(y: Pick<YieldRow, "feesUsdPerDay" | "incentivesUsdPerDay" | "incentivesLowUsdPerDay" | "steady" | "spike">): boolean {
  return !y.spike && steadySortScore(y) === 1;
}
