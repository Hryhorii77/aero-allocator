import type { Address } from "viem";
import type { FeeEvent } from "./gauge-fees";

// Fee releases of one gauge cut into fixed stretches of time, for a small history chart and a "how steady is this gauge" figure.
// Fees reach voters in lumps (a release whenever someone triggers it), so a single stretch with nothing in it says "no release
// then", not "no trading"; that is why steadiness is judged over half-days and needs several of them.

type TokenPrice = { priceUsd: number; decimals: number } | null | undefined;
type Ev = Pick<FeeEvent, "token" | "amount" | "blockNumber">;

/** Stretch used for the steadiness figure. */
export const STEADY_BUCKET_HOURS = 12;
/** Stretch used for the chart. */
export const CHART_BUCKET_HOURS = 6;
/** Fewer complete stretches than this and a steadiness figure would be noise. */
export const MIN_STEADY_BUCKETS = 3;
/** A stretch counts as paying when it brought at least this share of the average stretch. */
export const PAYING_SHARE_OF_MEAN = 0.5;

export interface FeeBucket {
  /** Start of the stretch, unix seconds. */
  t: number;
  /** Fees released in it, USD. */
  usd: number;
}

export interface Steadiness {
  /** Complete stretches measured. */
  buckets: number;
  /** How many of them paid at least half the average stretch. */
  paying: number;
}

export const usdOf = (e: Ev, price: (t: Address) => TokenPrice) => {
  const p = price(e.token);
  return p ? (Number(e.amount) / 10 ** p.decimals) * p.priceUsd : 0;
};

/**
 * Releases summed per stretch, oldest first, counting back from `nowSec`. Like the fee pace, the first release in the record is
 * dropped (it dumps fees that piled up over an unknown time) and only stretches that start after it are kept; the stretch still in
 * progress is left out, so every bucket returned is complete.
 */
export function feeBuckets(
  events: Ev[],
  headBlock: bigint,
  price: (t: Address) => TokenPrice,
  blockSec: number,
  nowSec: number,
  bucketHours: number,
): FeeBucket[] {
  if (events.length < 2) return [];
  const first = events.reduce((m, e) => (e.blockNumber < m ? e.blockNumber : m), events[0].blockNumber);
  const later = events.filter((e) => e.blockNumber > first);
  if (later.length === 0) return [];
  const width = bucketHours * 3600;
  const timeOf = (b: bigint) => nowSec - Number(headBlock - b) * blockSec;
  const startAt = timeOf(first);
  const out: FeeBucket[] = [];
  for (let i = 1; ; i++) {
    const start = nowSec - (i + 1) * width;
    if (start < startAt) break;
    out.unshift({ t: start, usd: 0 });
  }
  for (const e of later) {
    const age = nowSec - timeOf(e.blockNumber);
    const i = Math.floor(age / width);
    if (i < 1) continue; // still in the current, incomplete stretch
    const bucket = out[out.length - i];
    if (bucket) bucket.usd += usdOf(e, price);
  }
  return out;
}

/** How many complete half-days paid at least half the average one; null with too few stretches or nothing paid at all. */
export function steadiness(buckets: FeeBucket[]): Steadiness | null {
  if (buckets.length < MIN_STEADY_BUCKETS) return null;
  const mean = buckets.reduce((a, b) => a + b.usd, 0) / buckets.length;
  if (!(mean > 0)) return null;
  return { buckets: buckets.length, paying: buckets.filter((b) => b.usd >= mean * PAYING_SHARE_OF_MEAN).length };
}

/** Steadiness as 0-1 for sorting: the share of stretches that paid. */
export const steadyScore = (s: Steadiness | null | undefined) => (s ? s.paying / s.buckets : -1);

/** A pace this many times a gauge's usual level is called a spike. */
export const SPIKE_RATIO = 3;
/** Complete stretches needed before a gauge's usual level can be judged (two days of half-days). */
export const MIN_TYPICAL_BUCKETS = 4;

export interface Spike {
  /** What the gauge usually releases per day: the median complete half-day over everything the record keeps, scaled to a day. */
  typicalUsdPerDay: number;
}

/**
 * Whether `paceUsdPerDay` (the recent fee pace) is far above the gauge's usual level. The usual level is the median half-day, which a
 * couple of big releases cannot move, so a burst inside the pace window shows up against it. Null when the record is too short, or the
 * median half-day is empty (a gauge that releases rarely has no usual level to compare with), or the pace is not far above it.
 */
export function spikeOf(buckets: FeeBucket[], paceUsdPerDay: number): Spike | null {
  if (buckets.length < MIN_TYPICAL_BUCKETS) return null;
  const sorted = buckets.map((b) => b.usd).sort((a, b) => a - b);
  const mid = sorted.length / 2;
  const median = sorted.length % 2 ? sorted[Math.floor(mid)] : (sorted[mid - 1] + sorted[mid]) / 2;
  if (!(median > 0)) return null;
  const typical = (median * 24) / STEADY_BUCKET_HOURS;
  return paceUsdPerDay >= typical * SPIKE_RATIO ? { typicalUsdPerDay: typical } : null;
}
