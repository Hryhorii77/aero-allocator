import type { DailyHistory } from "./daily-history";
import { DAY_SEC } from "./daily-history";
import type { GaugeFees } from "./gauge-fees-read";
import { rankByUsdPerDay, type YieldRow } from "./gauge-yield";
import type { GaugeRow } from "./gauges";
import { gaugeLabel } from "./gauges";
import { projectRange } from "./projection";
import { bestSplit, splitRate } from "./split";

// A forward-only track record. Once a day, shortly after 00:00 UTC, the site logs the split it would recommend for TRACK_AMOUNT sAERO
// on Base, with the dollars per day it predicted (today's pace) and its low case. Two finished days later the log is compared with what
// those gauges really paid, taken from the daily record. Nothing is back-filled: an entry is what the model said at the time, which
// is the only fair way to ask whether its advice held up. Results are shown only once there are MIN_DAYS_TO_SHOW evaluated days.

export const TRACK_CHAIN_ID = 8453;
/** The amount every logged recommendation is for (the page's default). */
export const TRACK_AMOUNT = 10_000;
export const RETAIN_ENTRIES = 120;
/** Evaluated days needed before the page shows any result. */
export const MIN_DAYS_TO_SHOW = 14;
/** An entry is logged only in the first hours of a UTC day, so that "the next two days" lines up with the 47 h wait. */
export const LOG_WITHIN_SEC = 3 * 3600;

export interface TrackEntry {
  /** Unix seconds when it was logged. */
  t: number;
  /** UTC day number of `t`. */
  day: number;
  amount: number;
  parts: Array<{ g: string; s: string; pct: number }>;
  /** Predicted USD per day at today's fee pace, and the low case. */
  paceUsd: number;
  lowUsd: number;
  /** The ranking rule that chose the split (RANK_RULE); absent on entries made before rules were numbered, which are rule 1. */
  rule?: number;
  /** Where Aero Autopilot's pools had their power when the entry was logged (from 2026-11-11), to check a deposit there the same way. */
  ap?: AutopilotSnap[];
  /**
   * What the ranking saw for the split's gauges and the runners-up (from 2026-11-11), so a miss can be explained and another ranking
   * replayed without rebuilding the inputs: the 2-day fee pace and the 6-hour ledger behind it are kept only 4 days.
   */
  in?: PickInput[];
}

/** How many of the best-ranked gauges `recommend` keeps inputs for, besides every gauge in the split. */
export const INPUTS_KEPT = 10;

/**
 * One gauge as the ranking saw it at pick time. USD per day unless named: `f` the fee pace, `u` the usual level when the pace was a burst,
 * `i` incentives streaming now and `il` their average over the wait (when it is lower), `w` weight in whole tokens, `h` hours of fee
 * history behind the pace, `sp` / `sb` paying and complete half-days.
 */
export interface PickInput {
  g: string;
  f: number;
  u?: number;
  i: number;
  il?: number;
  w: number;
  h: number;
  sp?: number;
  sb?: number;
}

const r2 = (n: number) => Number(n.toFixed(2));

function pickInput(r: YieldRow): PickInput {
  return {
    g: r.gauge.toLowerCase(),
    f: r2(r.feesUsdPerDay),
    ...(r.spike ? { u: r2(r.spike.typicalUsdPerDay) } : {}),
    i: r2(r.incentivesUsdPerDay),
    ...(r.incentivesLowUsdPerDay !== undefined && r.incentivesLowUsdPerDay < r.incentivesUsdPerDay ? { il: r2(r.incentivesLowUsdPerDay) } : {}),
    w: Math.round(r.weight),
    h: Number(r.windowHours.toFixed(1)),
    ...(r.steady ? { sp: r.steady.paying, sb: r.steady.buckets } : {}),
  };
}

/**
 * One Autopilot pool at the moment an entry was logged: its whole power and, per chain, each gauge's amount (whole tokens). Power not on
 * a gauge (idle or in transit) earns nothing, as it does for a depositor. A pool is only logged when every chain could be read.
 */
export interface AutopilotSnap {
  id: number;
  power: number;
  parts: Array<{ c: number; g: string; a: number }>;
}

/**
 * The ranking rule `recommend` uses now. 1: splits ranked on each gauge's recent fee pace, bursts included. 2 (from 2026-11-04): a gauge
 * whose pace is a burst is ranked at its usual level (`splitRate`). Results are counted only for entries of the current rule, so the record
 * measures the model that is running; older entries stay listed, marked.
 */
export const RANK_RULE = 2;
export const ruleOf = (e: Pick<TrackEntry, "rule">) => e.rule ?? 1;

export interface TrackLog {
  version: 1;
  chainId: number;
  entries: TrackEntry[];
}

/** Whether `nowSec` is early enough in its UTC day to log. */
export const inLogWindow = (nowSec: number) => nowSec % DAY_SEC < LOG_WITHIN_SEC;

/** The recommendation as it stands now, or null when nothing can be ranked. */
export function recommend(gauges: GaugeRow[], fees: GaugeFees, nowSec: number, waitSec?: number, amount = TRACK_AMOUNT): TrackEntry | null {
  const ranked = rankByUsdPerDay(gauges, fees.fees, amount, undefined, { nowSec, waitSec });
  const split = bestSplit(ranked.map((r) => ({ gauge: r.gauge, symbol: gaugeLabel(r), rate: splitRate(r), weight: r.weight })), amount);
  if (!split) return null;
  const range = projectRange(ranked, split);
  const inSplit = new Set(split.parts.map((p) => p.gauge.toLowerCase()));
  const byRate = [...ranked].sort((a, b) => (splitRate(b) * amount) / (b.weight + amount) - (splitRate(a) * amount) / (a.weight + amount));
  const kept = byRate.filter((r, i) => i < INPUTS_KEPT || inSplit.has(r.gauge.toLowerCase()));
  return {
    t: nowSec,
    day: Math.floor(nowSec / DAY_SEC),
    amount,
    parts: split.parts.map((p) => ({ g: p.gauge.toLowerCase(), s: p.symbol, pct: p.pct })),
    paceUsd: Number(range.paceUsdPerDay.toFixed(4)),
    lowUsd: Number(range.lowUsdPerDay.toFixed(4)),
    rule: RANK_RULE,
    in: kept.map(pickInput),
  };
}

/** The log with `entry` added, newest last: one per UTC day, the oldest dropped past RETAIN_ENTRIES. Returns the same log when that day is already in. */
export function addEntry(log: TrackLog | null, entry: TrackEntry): TrackLog {
  const base: TrackLog = log ?? { version: 1, chainId: TRACK_CHAIN_ID, entries: [] };
  if (base.entries.some((e) => e.day === entry.day)) return base;
  return { ...base, entries: [...base.entries, entry].slice(-RETAIN_ENTRIES) };
}

/**
 * What the logged split really earned per day, on average over the entry's own UTC day and the next (the 47 h wait), from the daily
 * record: for each gauge the day's fees plus its incentives, times the share the entry's amount would have had of the gauge's weight
 * at the end of that day. Null until both days are finished and recorded, or when a gauge has no figures for one of them.
 */
export function realizedUsdPerDay(entry: TrackEntry, daily: DailyHistory | null): number | null {
  if (!daily) return null;
  const index = new Map(daily.gauges.map((g, i) => [g.toLowerCase(), i]));
  let total = 0;
  for (const d of [entry.day, entry.day + 1]) {
    const point = daily.points.find((p) => p.d === d);
    if (!point || point.w.length === 0) return null;
    for (const part of entry.parts) {
      const i = index.get(part.g);
      const fees = i === undefined ? undefined : point.f[i];
      const weight = i === undefined ? undefined : point.w[i];
      const inc = i === undefined ? undefined : point.i[i];
      if (fees === undefined || weight === undefined || inc === undefined) return null;
      const amt = (entry.amount * part.pct) / 100;
      // The daily record holds fees in USD (rounded to the cent) and incentives in USD per week. Until 2026-11-03 this divided fees by 100
      // as if they were cents, so every "actual" figure was 100 times too small (the WETH/MORPHO day showed $0.015 for a real $1.50).
      total += (fees + inc / 7) * (amt / (weight + amt));
    }
  }
  return total / 2;
}

/**
 * What `amount` deposited into one Autopilot pool really earned per day, over the entry's day and the next, from each chain's daily
 * record: the deposit is spread like the pool (a gauge holding a/P of its power gets a/P of the deposit, the idle share earns nothing),
 * and each gauge pays it the share it would have had of the gauge's end-of-day weight, as `realizedUsdPerDay` does for the split. It
 * assumes the keeper left the pool where it was for those two days, and it is before Autopilot's own fee, which Aero hasn't published.
 * Null until both days are recorded on every chain the pool used.
 */
export function autopilotRealizedUsdPerDay(snap: AutopilotSnap, day: number, amount: number, dailyOf: (chainId: number) => DailyHistory | null | undefined): number | null {
  if (!(snap.power > 0)) return null;
  const base = dailyOf(TRACK_CHAIN_ID);
  for (const d of [day, day + 1]) if (!base?.points.some((p) => p.d === d && p.w.length > 0)) return null;
  const indexes = new Map<number, Map<string, number>>();
  let total = 0;
  for (const d of [day, day + 1]) {
    for (const part of snap.parts) {
      const h = dailyOf(part.c);
      if (!h) return null;
      let index = indexes.get(part.c);
      if (!index) indexes.set(part.c, (index = new Map(h.gauges.map((g, i) => [g.toLowerCase(), i]))));
      const point = h.points.find((p) => p.d === d);
      const i = index.get(part.g.toLowerCase());
      if (!point || point.w.length === 0 || i === undefined) return null;
      const [fees, weight, inc] = [point.f[i], point.w[i], point.i[i]];
      if (fees === undefined || weight === undefined || inc === undefined) return null;
      const x = (amount * part.a) / snap.power;
      if (x > 0) total += (fees + inc / 7) * (x / (weight + x));
    }
  }
  return total / 2;
}

export interface TrackRow {
  day: number;
  parts: Array<{ s: string; pct: number }>;
  paceUsd: number;
  lowUsd: number;
  realizedUsd: number | null;
  /** The ranking rule that chose this split; only RANK_RULE days count toward the results. */
  rule: number;
  /** The same amount deposited into each Autopilot pool, largest pool first; absent on days logged before Autopilot was tracked. */
  autopilot?: Array<{ id: number; realizedUsd: number | null }>;
}

export interface TrackSummary {
  chainId: number;
  amount: number;
  /** Entries of the current rule logged so far, and how many have both days recorded. */
  logged: number;
  evaluated: number;
  /** The rule now running, and how many listed entries were made under an earlier one (shown, never counted). */
  rule: number;
  earlierRule: number;
  /** Evaluated days needed before results are shown. */
  needed: number;
  /** Set only once `evaluated` reaches `needed`. */
  results?: {
    /** Median of realized / predicted, as a fraction (0.7 = paid 70% of the predicted figure). */
    medianRealizedOfPredicted: number;
    /** Days on which it paid at least the low case. */
    atLeastLow: number;
    avgPredictedUsd: number;
    avgRealizedUsd: number;
  };
  /**
   * The split against the same amount in Autopilot's largest pool, over current-rule days where both are checked. Set only once there
   * are `needed` such days. Autopilot's figure is before its own fee.
   */
  vsAutopilot?: { days: number; avgSplitUsd: number; avgAutopilotUsd: number; splitAhead: number };
  /** The most recent entries, newest first. */
  rows: TrackRow[];
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * Counts, results and rows for the page. `daily` is Base's daily record; `dailies` holds the other chains' records, needed only to check
 * the Autopilot pools (a chain missing from it leaves those figures null).
 */
export function summarize(log: TrackLog | null, daily: DailyHistory | null, rowsShown = 21, dailies: Map<number, DailyHistory | null> = new Map()): TrackSummary {
  const entries = log?.entries ?? [];
  const dailyOf = (c: number) => (c === TRACK_CHAIN_ID ? daily : dailies.get(c));
  const rows: TrackRow[] = entries.map((e) => ({
    day: e.day,
    parts: e.parts.map((p) => ({ s: p.s, pct: p.pct })),
    paceUsd: e.paceUsd,
    lowUsd: e.lowUsd,
    realizedUsd: realizedUsdPerDay(e, daily),
    rule: ruleOf(e),
    ...(e.ap?.length
      ? { autopilot: [...e.ap].sort((a, b) => b.power - a.power).map((p) => ({ id: p.id, realizedUsd: rounded(autopilotRealizedUsdPerDay(p, e.day, e.amount, dailyOf)) })) }
      : {}),
  }));
  const current = rows.filter((r) => r.rule === RANK_RULE);
  const done = current.filter((r): r is TrackRow & { realizedUsd: number } => r.realizedUsd !== null && r.paceUsd > 0);
  const summary: TrackSummary = {
    chainId: TRACK_CHAIN_ID,
    amount: TRACK_AMOUNT,
    logged: current.length,
    evaluated: done.length,
    needed: MIN_DAYS_TO_SHOW,
    rule: RANK_RULE,
    earlierRule: rows.length - current.length,
    rows: rows.slice(-rowsShown).reverse(),
  };
  if (done.length >= MIN_DAYS_TO_SHOW) {
    summary.results = {
      medianRealizedOfPredicted: Number(median(done.map((r) => r.realizedUsd / r.paceUsd)).toFixed(3)),
      atLeastLow: done.filter((r) => r.realizedUsd >= r.lowUsd).length,
      avgPredictedUsd: Number((done.reduce((a, r) => a + r.paceUsd, 0) / done.length).toFixed(4)),
      avgRealizedUsd: Number((done.reduce((a, r) => a + r.realizedUsd, 0) / done.length).toFixed(4)),
    };
  }
  const both = done.filter((r) => r.autopilot?.[0]?.realizedUsd != null);
  if (both.length >= MIN_DAYS_TO_SHOW) {
    const ap = (r: TrackRow) => r.autopilot![0].realizedUsd!;
    summary.vsAutopilot = {
      days: both.length,
      avgSplitUsd: Number((both.reduce((a, r) => a + r.realizedUsd, 0) / both.length).toFixed(4)),
      avgAutopilotUsd: Number((both.reduce((a, r) => a + ap(r), 0) / both.length).toFixed(4)),
      splitAhead: both.filter((r) => r.realizedUsd > ap(r)).length,
    };
  }
  return summary;
}

const rounded = (n: number | null) => (n === null ? null : Number(n.toFixed(4)));
