import { SETTINGS, epochStart } from "./config.js";
import { forecastFees, recommendAllocation, type MarketSnapshot } from "./scoring.js";
import type { EpochStats, PoolForecast } from "./types.js";

/**
 * How the voter_roi split would actually have done in settled epochs, next to
 * the dumb alternative: everything into the one pool that paid the most per
 * vote last epoch — what a voter reading a reward-per-vote table does.
 *
 * For each replayed epoch t the engine only sees what existed before t:
 * - fee forecast from completed epochs before t (same forecastFees, same
 *   trailing window as live);
 * - "existing votes" and "posted bribes" are epoch t-1's final figures. Live
 *   voting sees t's partial votes and bribes instead; t's finals would be
 *   lookahead, so the previous epoch stands in for both.
 * Then the real recommendAllocation(voter_roi) runs on that reconstructed
 * market, and both it and the baseline are scored on what t actually paid:
 * R_t · v / (E_t + v), R = fees + bribes, E = the gauge's final votes — the
 * same payout formula the recommendation optimizes and tracking.ts reconciles.
 *
 * Known biases, stated rather than hidden: the pool universe is today's scan
 * (pools that died since aren't replayed — applies to both sides equally);
 * confidence is the raw heuristic, not the backtest-calibrated one the live
 * page uses (the calibration is fitted on these same epochs).
 */
export interface ReplayEpoch {
  epochStart: number;
  splitPoolCount: number;
  splitRealizedUsd: number;
  /** What the split's own model promised at the time, for reference. */
  splitExpectedUsd: number;
  topPool: { pool: string; symbol: string } | null;
  topPoolRealizedUsd: number;
  /** Of the pools predicted to pay most per vote, how many were still among the top payers once the epoch settled. */
  survival: { topN: number; stillTop: number } | null;
}

export interface VoterRoiReplay {
  votingPowerVe: number;
  epochs: ReplayEpoch[];
  splitRealizedUsd: number;
  /** Sum of what the split's own model promised over the same epochs. */
  splitExpectedUsd: number;
  /** realized / promised × 100; null when nothing was promised. */
  paidOfPromisedPct: number | null;
  topPoolRealizedUsd: number;
  /** (split − top pool) / top pool × 100; null when the baseline paid nothing. */
  vsTopPoolPct: number | null;
  epochsSplitWon: number;
  methodology: string;
}

export const REPLAY_METHODOLOGY =
  "Each settled epoch is replayed with only what existed before it: the fee forecast from earlier " +
  "epochs, and the previous epoch's final votes and bribes standing in for what was posted at vote " +
  "time. The voter_roi split is recomputed on that and scored on what the epoch actually paid " +
  "(fees + bribes, shared pro-rata with the gauge's final votes). Baseline: all votes into the pool " +
  "with the highest reward per vote the epoch before, among pools clearing the same reward floor.";

const MIN_TRAILING_EPOCHS = 2;
const SURVIVAL_TOP_N = 10;

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

function payout(actual: EpochStats, votes: number): number {
  return votes > 0 ? ((actual.feesUsd + actual.bribesUsd) * votes) / (actual.votes + votes) : 0;
}

export function replayVoterRoi(
  snapshot: MarketSnapshot,
  votingPowerVe: number,
  opts: { epochs?: number; maxPools?: number; /** Unix seconds; defaults to now. */ now?: number } = {},
): VoterRoiReplay {
  const { epochs = 5, maxPools = 8 } = opts;
  const nowEpoch = epochStart(opts.now ?? Math.floor(Date.now() / 1000));

  const completedByPool = snapshot.forecasts.map((f) => ({
    f,
    completed: f.history.filter((e) => e.ts < nowEpoch).sort((a, b) => b.ts - a.ts),
  }));

  // Newest settled epochs that at least one pool can forecast from real
  // trailing history — the rest of the pools just sit that epoch out.
  const replayable = [
    ...new Set(
      completedByPool.flatMap(({ completed }) =>
        completed.filter((_, i) => completed.length - (i + 1) >= MIN_TRAILING_EPOCHS).map((e) => e.ts),
      ),
    ),
  ]
    .sort((a, b) => b - a)
    .slice(0, epochs);

  const results: ReplayEpoch[] = [];
  for (const ts of replayable) {
    const rows: Array<{ forecast: PoolForecast; prev: EpochStats; actual: EpochStats }> = [];
    for (const { f, completed } of completedByPool) {
      const idx = completed.findIndex((e) => e.ts === ts);
      if (idx < 0) continue;
      const trailing = completed.slice(idx + 1, idx + 1 + SETTINGS.historyEpochs);
      if (trailing.length < MIN_TRAILING_EPOCHS) continue;
      const prev = trailing[0];
      const { predicted, trend, confidence } = forecastFees(trailing.map((e) => e.feesUsd));
      const prevRewards = prev.feesUsd + prev.bribesUsd;
      rows.push({
        prev,
        actual: completed[idx],
        forecast: {
          pool: f.pool,
          history: trailing,
          predictedFeesUsd: round2(predicted),
          lastEpochFeesUsd: round2(prev.feesUsd),
          feeTrendUsdPerEpoch: round2(trend),
          currentBribesUsd: round2(prev.bribesUsd),
          currentVotes: Math.round(prev.votes),
          // Shares only feed the non-voter_roi objectives and prose; filled
          // in below so the reconstructed forecast is complete anyway.
          voteShare: 0,
          predictedDemandShare: 0,
          predictiveEdge: 0,
          rewardPer1kVotesUsd: prev.votes > 0 ? round2((prevRewards / prev.votes) * 1000) : 0,
          confidence,
        },
      });
    }
    if (rows.length === 0) continue;

    const totalVotes = rows.reduce((s, r) => s + r.forecast.currentVotes, 0);
    const totalPredicted = rows.reduce((s, r) => s + r.forecast.predictedFeesUsd, 0);
    for (const { forecast } of rows) {
      forecast.voteShare = totalVotes > 0 ? forecast.currentVotes / totalVotes : 0;
      forecast.predictedDemandShare = totalPredicted > 0 ? forecast.predictedFeesUsd / totalPredicted : 0;
      forecast.predictiveEdge = forecast.predictedDemandShare - forecast.voteShare;
    }

    const byLp = new Map(rows.map((r) => [r.forecast.pool.lp.toLowerCase(), r]));
    const rec = recommendAllocation(
      { generatedAt: ts * 1000, forecasts: rows.map((r) => r.forecast) },
      "voter_roi",
      maxPools,
      votingPowerVe,
    );
    const splitRealizedUsd = rec.allocations.reduce((s, a) => {
      const row = byLp.get(a.pool.toLowerCase());
      return row ? s + payout(row.actual, (votingPowerVe * a.weightPct) / 100) : s;
    }, 0);
    const splitExpectedUsd = rec.allocations.reduce((s, a) => s + (a.expectedRewardUsd ?? 0), 0);

    // The baseline gets the same eligibility the engine does (live gauge,
    // clears the reward floor) — otherwise "top reward per vote" is a dust
    // gauge with three votes on it, and beating that proves nothing.
    const top = rows
      .filter(
        (r) =>
          r.forecast.pool.gaugeAlive &&
          r.prev.votes > 0 &&
          r.prev.feesUsd + r.prev.bribesUsd >= SETTINGS.minVoterRewardCapacityUsd,
      )
      .sort(
        (a, b) =>
          (b.prev.feesUsd + b.prev.bribesUsd) / b.prev.votes - (a.prev.feesUsd + a.prev.bribesUsd) / a.prev.votes,
      )[0];

    // Survival: rank the same eligible pools by predicted reward per vote
    // (forecast fees + posted bribes over the last settled votes) and by what
    // they paid per vote once the epoch closed; how much of the first top
    // list is still in the second.
    const eligible = rows.filter(
      (r) =>
        r.forecast.pool.gaugeAlive &&
        r.prev.votes > 0 &&
        r.actual.votes > 0 &&
        r.prev.feesUsd + r.prev.bribesUsd >= SETTINGS.minVoterRewardCapacityUsd,
    );
    const topN = Math.min(SURVIVAL_TOP_N, Math.floor(eligible.length / 2));
    let survival: ReplayEpoch["survival"] = null;
    if (topN >= 3) {
      const top = (score: (r: (typeof eligible)[number]) => number) =>
        new Set(
          [...eligible]
            .sort((a, b) => score(b) - score(a))
            .slice(0, topN)
            .map((r) => r.forecast.pool.lp),
        );
      const predicted = top((r) => (r.forecast.predictedFeesUsd + r.prev.bribesUsd) / r.prev.votes);
      const paid = top((r) => (r.actual.feesUsd + r.actual.bribesUsd) / r.actual.votes);
      survival = { topN, stillTop: [...predicted].filter((lp) => paid.has(lp)).length };
    }

    results.push({
      epochStart: ts,
      splitPoolCount: rec.allocations.length,
      splitRealizedUsd: round2(splitRealizedUsd),
      splitExpectedUsd: round2(splitExpectedUsd),
      topPool: top ? { pool: top.forecast.pool.lp, symbol: top.forecast.pool.symbol } : null,
      topPoolRealizedUsd: top ? round2(payout(top.actual, votingPowerVe)) : 0,
      survival,
    });
  }

  const splitTotal = results.reduce((s, e) => s + e.splitRealizedUsd, 0);
  const topTotal = results.reduce((s, e) => s + e.topPoolRealizedUsd, 0);
  const expectedTotal = results.reduce((s, e) => s + e.splitExpectedUsd, 0);
  return {
    votingPowerVe,
    epochs: results,
    splitRealizedUsd: round2(splitTotal),
    splitExpectedUsd: round2(expectedTotal),
    paidOfPromisedPct: expectedTotal > 0 ? Math.round((splitTotal / expectedTotal) * 1000) / 10 : null,
    topPoolRealizedUsd: round2(topTotal),
    vsTopPoolPct: topTotal > 0 ? Math.round(((splitTotal - topTotal) / topTotal) * 1000) / 10 : null,
    epochsSplitWon: results.filter((e) => e.splitRealizedUsd > e.topPoolRealizedUsd).length,
    methodology: REPLAY_METHODOLOGY,
  };
}
