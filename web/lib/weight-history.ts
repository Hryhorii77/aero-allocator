import { MIN_RANK_WEIGHT } from "./gauge-yield";

// A stored record of each gauge's allocation weight, one snapshot every ~30 minutes, so the page can show which gauges are gaining or
// losing power. The chain only knows the weight now; the movement has to be accumulated, like the fee record.
//
// Compact on purpose: the gauge addresses are listed once and each snapshot is a plain array aligned with that list (new gauges are
// appended, so older snapshots are simply shorter). A snapshot is whole tokens, ~270 numbers.

/** Snapshots closer than this are skipped, so a retried cron doesn't pile up near-duplicates. */
export const MIN_SNAPSHOT_GAP_SEC = 20 * 60;
/** Snapshots older than this are dropped. */
export const RETAIN_SEC = 3 * 86_400;
/** The default look-back for the flow figure. */
export const FLOW_WINDOW_HOURS = 24;
/** Less history than this between the first and last snapshot shows no flows at all: a few minutes of drift says nothing. */
export const MIN_SPAN_HOURS = 2;

export interface WeightSnapshot {
  /** Unix seconds. */
  t: number;
  /** Whole-token weight per gauge, aligned with WeightHistory.gauges. */
  w: number[];
}

export interface WeightHistory {
  version: 1;
  chainId: number;
  /** Lowercase gauge addresses, append-only. */
  gauges: string[];
  points: WeightSnapshot[];
}

export interface Flow {
  gauge: string;
  /** Change in this gauge's share of all weight on the chain, in percent of its earlier share (+20 = its share grew by a fifth). */
  sharePctChange: number;
  /** Raw change in power. Includes the slow decay of expiring locks, which the share figure removes. */
  powerChange: number;
  /** Weight now. */
  weight: number;
}

export interface Flows {
  chainId: number;
  /** Hours between the snapshot compared against and the latest one; 0 when there isn't enough history. */
  spanHours: number;
  flows: Flow[];
}

/** Adds a snapshot of the current weights (or starts the record), dropping old ones. Returns the same record untouched when the last snapshot is too recent. */
export function recordSnapshot(
  history: WeightHistory | null,
  chainId: number,
  rows: Array<{ gauge: string; weight: number }>,
  nowSec: number,
): WeightHistory {
  const base: WeightHistory = history && history.chainId === chainId ? history : { version: 1, chainId, gauges: [], points: [] };
  const last = base.points[base.points.length - 1];
  if (last && nowSec - last.t < MIN_SNAPSHOT_GAP_SEC) return base;
  const gauges = [...base.gauges];
  const index = new Map(gauges.map((g, i) => [g, i]));
  for (const r of rows) {
    const key = r.gauge.toLowerCase();
    if (!index.has(key)) {
      index.set(key, gauges.length);
      gauges.push(key);
    }
  }
  const w = new Array<number>(gauges.length).fill(0);
  for (const r of rows) w[index.get(r.gauge.toLowerCase())!] = Math.max(0, Math.round(r.weight));
  const points = [...base.points, { t: nowSec, w }].filter((p) => nowSec - p.t <= RETAIN_SEC);
  return { version: 1, chainId, gauges, points };
}

const sum = (w: number[]) => w.reduce((a, b) => a + b, 0);

/**
 * How each gauge's share of the chain's weight moved between the oldest snapshot inside the window and the latest. Comparing shares
 * (not raw power) takes out the decay every expiring lock causes, which lowers all weights together. Gauges that were too thin to
 * judge, or didn't exist yet, are left out.
 */
export function computeFlows(history: WeightHistory | null, nowSec: number, windowHours: number = FLOW_WINDOW_HOURS): Flows {
  const none = (chainId: number): Flows => ({ chainId, spanHours: 0, flows: [] });
  if (!history || history.points.length < 2) return none(history?.chainId ?? 0);
  const latest = history.points[history.points.length - 1];
  const from = history.points.find((p) => nowSec - p.t <= windowHours * 3600 && p !== latest);
  if (!from) return none(history.chainId);
  const spanHours = (latest.t - from.t) / 3600;
  if (spanHours < MIN_SPAN_HOURS) return none(history.chainId);
  const totalNow = sum(latest.w);
  const totalThen = sum(from.w);
  if (totalNow <= 0 || totalThen <= 0) return none(history.chainId);
  const flows: Flow[] = [];
  history.gauges.forEach((gauge, i) => {
    const now = latest.w[i] ?? 0;
    const then = from.w[i];
    if (then === undefined || then < MIN_RANK_WEIGHT / 10) return;
    const shareNow = now / totalNow;
    const shareThen = then / totalThen;
    flows.push({ gauge, sharePctChange: (shareNow / shareThen - 1) * 100, powerChange: now - then, weight: now });
  });
  return { chainId: history.chainId, spanHours, flows };
}

/** The biggest risers and fallers among gauges with enough power to matter (the same bar as the ranking). */
export function topMovers(flows: Flow[], count = 3, minWeight: number = MIN_RANK_WEIGHT): { gaining: Flow[]; losing: Flow[] } {
  const eligible = flows.filter((f) => f.weight >= minWeight);
  const gaining = eligible.filter((f) => f.sharePctChange > 0).sort((a, b) => b.sharePctChange - a.sharePctChange).slice(0, count);
  const losing = eligible.filter((f) => f.sharePctChange < 0).sort((a, b) => a.sharePctChange - b.sharePctChange).slice(0, count);
  return { gaining, losing };
}

/** "+12%" / "−8%"; a change under half a percent reads as flat. */
export function formatFlow(pct: number): string {
  if (Math.abs(pct) < 0.5) return "flat";
  const v = Math.abs(pct) >= 100 ? Math.round(Math.abs(pct)) : Math.abs(pct) >= 10 ? Math.round(Math.abs(pct)) : Math.abs(pct).toFixed(1);
  return `${pct > 0 ? "+" : "−"}${v}%`;
}
