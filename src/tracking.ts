import type { MarketSnapshot } from "./scoring.js";
import type { Protocol } from "./config.js";
import { WEEK } from "./config.js";

export interface LoggedAllocation {
  pool: string;
  symbol: string;
  weightPct: number;
  /** Approximated as votingPowerVe * weightPct / 100 — exact when all voting power gets allocated, a slight overcount if some was left unused (fully-capped pools, dust filtering). */
  votesAllocated: number;
  expectedRewardUsd: number;
}

export interface LoggedRecommendation {
  epochStart: number;
  generatedAt: string;
  protocol: Protocol;
  votingPowerVe: number;
  allocations: LoggedAllocation[];
  totalExpectedRewardUsd: number;
}

export interface PoolRealized {
  pool: string;
  symbol: string;
  votesAllocated: number;
  expectedRewardUsd: number;
  /** null when this epoch's data has rolled off the live history window (see computeRealizedPerformance). */
  realizedRewardUsd: number | null;
}

export interface RealizedEpochResult {
  epochStart: number;
  protocol: Protocol;
  votingPowerVe: number;
  totalExpectedRewardUsd: number;
  totalRealizedRewardUsd: number;
  /** (realized - expected) / expected * 100 — negative means the recommendation overpromised. */
  skillPct: number;
  pools: PoolRealized[];
}

/**
 * Compares logged voter_roi recommendations against what actually
 * happened, for every logged epoch that has since completed. Realized
 * reward per pool mirrors the exact formula recommendAllocation used to
 * predict it — R·v/(E+v) — just with the epoch's now-final, actual R
 * (fees+bribes) and E (votes) instead of the predicted ones. Same
 * structure, different inputs, so the comparison is apples to apples
 * rather than two different models of "expected reward."
 *
 * Needs a snapshot whose per-pool history still covers the logged
 * epochStart (SETTINGS.historyEpochs = 8 by default) — reconcile within a
 * few weeks of each epoch completing, not months later.
 *
 * Caveat: E (the pool's actual recorded votes) may or may not already
 * include the v votes this recommendation allocated — we don't know
 * whether you actually voted this way. If you did, this slightly
 * understates your realized share (your own v is double-counted in E).
 */
export function computeRealizedPerformance(
  log: LoggedRecommendation[],
  snapshot: MarketSnapshot,
): RealizedEpochResult[] {
  const now = Date.now() / 1000;
  const results: RealizedEpochResult[] = [];

  for (const entry of log) {
    if (entry.epochStart + WEEK > now) continue; // epoch hasn't completed yet

    const pools: PoolRealized[] = entry.allocations.map((a) => {
      const forecast = snapshot.forecasts.find((f) => f.pool.lp.toLowerCase() === a.pool.toLowerCase());
      const epoch = forecast?.history.find((e) => e.ts === entry.epochStart);
      const realizedRewardUsd = epoch
        ? round2(((epoch.feesUsd + epoch.bribesUsd) * a.votesAllocated) / (epoch.votes + a.votesAllocated))
        : null;
      return {
        pool: a.pool,
        symbol: a.symbol,
        votesAllocated: a.votesAllocated,
        expectedRewardUsd: a.expectedRewardUsd,
        realizedRewardUsd,
      };
    });

    const known = pools.filter((p): p is PoolRealized & { realizedRewardUsd: number } => p.realizedRewardUsd !== null);
    if (known.length === 0) continue; // this epoch's data has rolled off the history window

    const totalRealizedRewardUsd = round2(known.reduce((s, p) => s + p.realizedRewardUsd, 0));
    const totalExpectedRewardUsd = entry.totalExpectedRewardUsd;
    const skillPct =
      totalExpectedRewardUsd > 0
        ? round2(((totalRealizedRewardUsd - totalExpectedRewardUsd) / totalExpectedRewardUsd) * 100)
        : 0;

    results.push({
      epochStart: entry.epochStart,
      protocol: entry.protocol,
      votingPowerVe: entry.votingPowerVe,
      totalExpectedRewardUsd,
      totalRealizedRewardUsd,
      skillPct,
      pools,
    });
  }

  return results.sort((a, b) => b.epochStart - a.epochStart);
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}
