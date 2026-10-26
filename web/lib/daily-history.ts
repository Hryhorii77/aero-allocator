import type { WeightHistory } from "./weight-history";

// A long, coarse record kept next to the 4-day fee record and the 3-day weight snapshots: one point per finished UTC day with the
// fees each gauge released, and its weight and incentives at the end of the day. The finer records roll off after days, and what
// they hold can't be read from the chain afterwards (public nodes serve ~10,000 blocks of logs), so this keeps the part worth
// keeping. About 270 gauges x 3 numbers x 90 days is a few hundred kB per chain, written once a day.

export const DAY_SEC = 86_400;
/** Days older than this are dropped. */
export const RETAIN_DAILY_DAYS = 90;

export interface DailyPoint {
  /** UTC day number: unix seconds / 86,400, rounded down. */
  d: number;
  /** Fees released to voters per gauge that day, USD (cents), aligned with DailyHistory.gauges. */
  f: number[];
  /** Weight per gauge at the last snapshot of the day, whole tokens. Empty when no snapshot was taken that day. */
  w: number[];
  /** Incentives streaming per gauge at that snapshot, whole USD per week. Empty like `w`. */
  i: number[];
}

export interface DailyHistory {
  version: 1;
  chainId: number;
  /** Lowercase gauge addresses, append-only. */
  gauges: string[];
  /**
   * Aligned with `gauges`: 1 once the gauge's first release in the record has been seen and left out. That release dumps fees that
   * piled up over an unknown time, so, like the fee pace, it is never counted as a day's fees.
   */
  seen: number[];
  points: DailyPoint[];
}

export interface Release {
  /** Unix seconds. */
  t: number;
  usd: number;
}

/** The first UTC day that still needs recording, or null when everything finished is in already. */
export function nextDayToRecord(history: DailyHistory | null, coverageFromSec: number, nowSec: number): number | null {
  const finished = Math.floor(nowSec / DAY_SEC); // days before this one are over
  const last = history && history.points.length > 0 ? history.points[history.points.length - 1].d : null;
  const first = Math.max(last === null ? -Infinity : last + 1, Math.ceil(coverageFromSec / DAY_SEC));
  return first < finished ? first : null;
}

/**
 * Adds every finished UTC day not yet recorded. `releases` is each gauge's releases within the fee record, already priced; only days
 * the fee record covers from start to end are added, so a day is never recorded half-seen. Returns the same object when there is
 * nothing to add, so a caller can skip the write.
 */
export function rollupDays(
  history: DailyHistory | null,
  chainId: number,
  releases: Array<{ gauge: string; releases: Release[] }>,
  coverageFromSec: number,
  weights: WeightHistory | null,
  nowSec: number,
): DailyHistory | null {
  const base: DailyHistory = history && history.chainId === chainId ? history : { version: 1, chainId, gauges: [], seen: [], points: [] };
  const from = nextDayToRecord(base, coverageFromSec, nowSec);
  if (from === null) return history;
  const through = Math.floor(nowSec / DAY_SEC) - 1;

  const gauges = [...base.gauges];
  const index = new Map(gauges.map((g, i) => [g, i]));
  for (const r of releases) {
    const key = r.gauge.toLowerCase();
    if (!index.has(key)) {
      index.set(key, gauges.length);
      gauges.push(key);
    }
  }
  const seen = gauges.map((_, i) => base.seen[i] ?? 0);

  const fees = new Map<number, number[]>();
  for (let d = from; d <= through; d++) fees.set(d, new Array<number>(gauges.length).fill(0));
  for (const r of releases) {
    const k = index.get(r.gauge.toLowerCase())!;
    const sorted = [...r.releases].sort((a, b) => a.t - b.t);
    if (seen[k] === 0 && sorted.length > 0) {
      sorted.shift();
      seen[k] = 1;
    }
    for (const e of sorted) {
      const row = fees.get(Math.floor(e.t / DAY_SEC));
      if (row) row[k] += e.usd;
    }
  }

  const wIndex = weights ? new Map(weights.gauges.map((g, i) => [g, i])) : new Map<string, number>();
  const points = [...base.points];
  for (let d = from; d <= through; d++) {
    const snap = weights ? [...weights.points].reverse().find((p) => Math.floor(p.t / DAY_SEC) === d) : undefined;
    const pick = (arr: number[] | undefined) => (arr ? gauges.map((g) => arr[wIndex.get(g) ?? -1] ?? 0) : []);
    points.push({ d, f: fees.get(d)!.map((x) => Math.round(x * 100) / 100), w: pick(snap?.w), i: pick(snap?.i) });
  }
  return { version: 1, chainId, gauges, seen, points: points.filter((p) => p.d >= through - RETAIN_DAILY_DAYS + 1) };
}

export interface DailyGaugePoint {
  /** Start of the UTC day, unix seconds. */
  t: number;
  feesUsd: number;
  weight: number | null;
  incentivesUsdPerWeek: number | null;
}

/** One gauge's column of the record, oldest day first. */
export function dailyForGauge(history: DailyHistory | null, gauge: string): DailyGaugePoint[] {
  if (!history) return [];
  const k = history.gauges.indexOf(gauge.toLowerCase());
  if (k < 0) return [];
  return history.points
    .filter((p) => k < p.f.length)
    .map((p) => ({ t: p.d * DAY_SEC, feesUsd: p.f[k] ?? 0, weight: p.w.length > 0 ? (p.w[k] ?? 0) : null, incentivesUsdPerWeek: p.i.length > 0 ? (p.i[k] ?? 0) : null }));
}
