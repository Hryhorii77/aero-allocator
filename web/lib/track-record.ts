import type { DailyHistory } from "./daily-history";
import { DAY_SEC } from "./daily-history";
import type { GaugeFees } from "./gauge-fees-read";
import { rankByUsdPerDay } from "./gauge-yield";
import type { GaugeRow } from "./gauges";
import { gaugeLabel } from "./gauges";
import { projectRange } from "./projection";
import { bestSplit } from "./split";

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
}

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
  const split = bestSplit(ranked.map((r) => ({ gauge: r.gauge, symbol: gaugeLabel(r), rate: r.feesUsdPerDay + r.incentivesUsdPerDay, weight: r.weight })), amount);
  if (!split) return null;
  const range = projectRange(ranked, split);
  return {
    t: nowSec,
    day: Math.floor(nowSec / DAY_SEC),
    amount,
    parts: split.parts.map((p) => ({ g: p.gauge.toLowerCase(), s: p.symbol, pct: p.pct })),
    paceUsd: Number(range.paceUsdPerDay.toFixed(4)),
    lowUsd: Number(range.lowUsdPerDay.toFixed(4)),
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
      total += (fees / 100 + inc / 7) * (amt / (weight + amt));
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
}

export interface TrackSummary {
  chainId: number;
  amount: number;
  /** Entries logged so far, and how many have both days recorded. */
  logged: number;
  evaluated: number;
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
  /** The most recent entries, newest first. */
  rows: TrackRow[];
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export function summarize(log: TrackLog | null, daily: DailyHistory | null, rowsShown = 21): TrackSummary {
  const entries = log?.entries ?? [];
  const rows: TrackRow[] = entries.map((e) => ({ day: e.day, parts: e.parts.map((p) => ({ s: p.s, pct: p.pct })), paceUsd: e.paceUsd, lowUsd: e.lowUsd, realizedUsd: realizedUsdPerDay(e, daily) }));
  const done = rows.filter((r): r is TrackRow & { realizedUsd: number } => r.realizedUsd !== null && r.paceUsd > 0);
  const summary: TrackSummary = { chainId: TRACK_CHAIN_ID, amount: TRACK_AMOUNT, logged: entries.length, evaluated: done.length, needed: MIN_DAYS_TO_SHOW, rows: rows.slice(-rowsShown).reverse() };
  if (done.length >= MIN_DAYS_TO_SHOW) {
    summary.results = {
      medianRealizedOfPredicted: Number(median(done.map((r) => r.realizedUsd / r.paceUsd)).toFixed(3)),
      atLeastLow: done.filter((r) => r.realizedUsd >= r.lowUsd).length,
      avgPredictedUsd: Number((done.reduce((a, r) => a + r.paceUsd, 0) / done.length).toFixed(4)),
      avgRealizedUsd: Number((done.reduce((a, r) => a + r.realizedUsd, 0) / done.length).toFixed(4)),
    };
  }
  return summary;
}
