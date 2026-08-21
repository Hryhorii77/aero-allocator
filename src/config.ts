// Aerodrome Sugar deployments on Base (chain 8453).
// Source: velodrome-finance/sugar deployments/base.env
export const ADDRESSES = {
  lpSugar: "0x69dD9db6d8f8E7d83887A704f447b1a584b599A1",
  rewardsSugar: "0x1b121EfDaF4ABb8785a315C51D29BCE0552A7678",
  veSugar: "0x4d6A741cEE6A8cC5632B2d948C050303F6246D24",
  voter: "0x16613524e02ad97eDfeF371bC883F2F5d6C480A5",
  aero: "0x940181a94A35A4569E4529A3CDfB74e38FD98631",
} as const;

// publicnode sustains the heavy Sugar scan (~70 x 500-pool eth_calls) without
// rate limiting; mainnet.base.org throttles it into minutes of backoff.
export const BASE_RPC_URL = process.env.BASE_RPC_URL ?? "https://base-rpc.publicnode.com";

// Aerodrome epochs: 1 week, starting Thursday 00:00 UTC (unix ts % WEEK == 0).
export const WEEK = 7 * 24 * 60 * 60;

export function epochStart(ts: number): number {
  return Math.floor(ts / WEEK) * WEEK;
}

export function currentEpochStart(): number {
  return epochStart(Math.floor(Date.now() / 1000));
}

/** Fraction of the current epoch that has elapsed (0..1). */
export function epochProgress(): number {
  const now = Math.floor(Date.now() / 1000);
  return (now - currentEpochStart()) / WEEK;
}

// Tuning knobs for data fetching and scoring.
export const SETTINGS = {
  /** How many pools to pull per LpSugar.all() page (contract max 500). */
  poolPageSize: 500,
  /** Minimum staked TVL (USD) for a pool to be considered a candidate. */
  minTvlUsd: Number(process.env.AERO_MIN_TVL_USD ?? 50_000),
  /** How many top candidate pools get full epoch-history analysis. */
  maxCandidates: Number(process.env.AERO_MAX_CANDIDATES ?? 60),
  /** Epochs of history to fetch per pool. */
  historyEpochs: 8,
  /** Concurrency for per-pool RPC calls. */
  rpcConcurrency: Number(process.env.AERO_RPC_CONCURRENCY ?? 4),
  /** Concurrency for the heavy full-range pool scan (public RPCs rate-limit hard). */
  scanConcurrency: Number(process.env.AERO_SCAN_CONCURRENCY ?? 3),
  /** EWMA decay for demand forecasting (weight on most recent epoch). */
  ewmaAlpha: 0.45,
  /** Minimum expected epoch rewards (USD) for a pool to receive voter_roi votes. */
  minVoterRewardCapacityUsd: Number(process.env.AERO_MIN_REWARD_CAPACITY_USD ?? 500),
  /** Cache TTL for the full market snapshot, ms. */
  cacheTtlMs: 5 * 60 * 1000,
  /** Cache TTL for the raw full-range pool scan, ms (pool set changes slowly). */
  poolScanTtlMs: 60 * 60 * 1000,
  /** Epochs of history to fetch per pool for the backtest (deeper than live forecasting; same call count). */
  backtestEpochs: Number(process.env.AERO_BACKTEST_EPOCHS ?? 26),
  /** How many top pools the backtest analyzes by default. */
  backtestMaxPools: Number(process.env.AERO_BACKTEST_MAX_POOLS ?? 30),
  /** Cache TTL for the default-params backtest report, ms (doesn't need to be fresher than an epoch). */
  backtestCacheTtlMs: 60 * 60 * 1000,
} as const;
