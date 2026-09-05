export interface PoolInfo {
  lp: string;
  symbol: string;
  poolType: "v2-stable" | "v2-volatile" | "concentrated";
  tickSpacing: number | null;
  token0: string;
  token1: string;
  gauge: string;
  gaugeAlive: boolean;
  reserve0: number;
  reserve1: number;
  staked0: number;
  staked1: number;
  tvlUsd: number;
  stakedTvlUsd: number;
  poolFeeBps: number;
  /** Current epoch AERO emissions per second (raw units, 18 decimals). */
  emissionsPerSec: number;
}

export interface EpochStats {
  ts: number;
  votes: number;
  /** That epoch's AERO emission RATE per second (matches PoolInfo.emissionsPerSec), not a per-epoch total — multiply by WEEK to get total AERO emitted. */
  emissions: number;
  feesUsd: number;
  bribesUsd: number;
}

export interface PoolForecast {
  pool: PoolInfo;
  history: EpochStats[];
  /** Predicted trading-fee revenue for the next epoch, USD. */
  predictedFeesUsd: number;
  /** Fees in the most recently completed epoch, USD. */
  lastEpochFeesUsd: number;
  /** Linear trend of fee history, USD per epoch (positive = growing demand). */
  feeTrendUsdPerEpoch: number;
  /** Current bribes offered this epoch, USD. */
  currentBribesUsd: number;
  /** Votes currently cast on this pool's gauge (veAERO units). */
  currentVotes: number;
  /** Current vote share across analyzed pools (0..1). */
  voteShare: number;
  /** Predicted fee-demand share across analyzed pools (0..1). */
  predictedDemandShare: number;
  /** predictedDemandShare - voteShare: positive = under-incentivized. */
  predictiveEdge: number;
  /** Expected voter ROI: (fees + bribes USD) per 1000 veAERO votes, last epoch. */
  rewardPer1kVotesUsd: number;
  /** 0..1 forecast confidence from history depth and variance. */
  confidence: number;
}

export type AllocationObjective = "protocol_efficiency" | "voter_roi" | "edge_hunter";

export interface AllocationRecommendation {
  objective: AllocationObjective;
  generatedAt: string;
  epochStart: number;
  epochProgressPct: number;
  /** veAERO voting power the voter_roi weights were sized for. */
  votingPowerVe?: number;
  allocations: Array<{
    pool: string;
    symbol: string;
    weightPct: number;
    currentVoteSharePct: number;
    predictedDemandSharePct: number;
    predictiveEdgePct: number;
    rewardPer1kVotesUsd: number;
    tvlUsd: number;
    currentVotes: number;
    /** Absolute votes this allocation assigns to the pool (voter_roi only — the other objectives express weight as a % of demand, not an absolute vote count). */
    votesAllocated?: number;
    /** Expected USD reward next epoch for the votes allocated here, after dilution. */
    expectedRewardUsd?: number;
    confidence: number;
    rationale: string;
  }>;
  summary: string;
}
