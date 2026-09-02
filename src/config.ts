import { base, optimism, type Chain } from "viem/chains";

export type Protocol = "aerodrome" | "velodrome";

export interface ProtocolPreset {
  protocol: Protocol;
  /** Display name for the protocol (e.g. "Aerodrome", "Velodrome"). */
  displayName: string;
  /** Reward/governance token symbol (e.g. "AERO", "VELO"). */
  tokenSymbol: string;
  /** Display name for the ve-NFT governance token (e.g. "veAERO", "veVELO"). */
  veTokenSymbol: string;
  /** Conventional chain name for prose (viem's Chain.name is technically correct but reads oddly, e.g. "OP Mainnet"). */
  networkName: string;
  chain: Chain;
  defaultRpcUrl: string;
  /** A second, independently-operated public RPC — used as an automatic failover if defaultRpcUrl (or a configured RPC_URL) is down, not just rate-limited. */
  fallbackRpcUrl: string;
  addresses: {
    lpSugar: `0x${string}`;
    rewardsSugar: `0x${string}`;
    veSugar: `0x${string}`;
    voter: `0x${string}`;
    /** Native reward/governance token (AERO or VELO) — used to price staking emissions. */
    rewardToken: `0x${string}`;
  };
}

// Both are Sugar/ve(3,3) deployments from the same lineage (Aerodrome is a
// Velodrome fork); addresses sourced from velodrome-finance/sugar's
// deployments/{base,optimism}.env, reward-token addresses cross-checked
// against DefiLlama + CoinGecko.
const PRESETS: Record<Protocol, ProtocolPreset> = {
  aerodrome: {
    protocol: "aerodrome",
    displayName: "Aerodrome",
    tokenSymbol: "AERO",
    veTokenSymbol: "veAERO",
    networkName: "Base",
    chain: base,
    defaultRpcUrl: "https://base-rpc.publicnode.com",
    fallbackRpcUrl: "https://mainnet.base.org",
    addresses: {
      lpSugar: "0x69dD9db6d8f8E7d83887A704f447b1a584b599A1",
      rewardsSugar: "0x1b121EfDaF4ABb8785a315C51D29BCE0552A7678",
      veSugar: "0x4d6A741cEE6A8cC5632B2d948C050303F6246D24",
      voter: "0x16613524e02ad97eDfeF371bC883F2F5d6C480A5",
      rewardToken: "0x940181a94A35A4569E4529A3CDfB74e38FD98631",
    },
  },
  velodrome: {
    protocol: "velodrome",
    displayName: "Velodrome",
    tokenSymbol: "VELO",
    veTokenSymbol: "veVELO",
    networkName: "Optimism",
    chain: optimism,
    defaultRpcUrl: "https://mainnet.optimism.io",
    fallbackRpcUrl: "https://optimism.publicnode.com",
    addresses: {
      lpSugar: "0x347512180804A8B40AA7525AE932a31198F074aA",
      rewardsSugar: "0x62CCFB2496f49A80B0184AD720379B529E9152fB",
      veSugar: "0xFE0a44d356a9F52c9F1bE0ba0f0877d986438c9C",
      voter: "0x41C914ee0c7E1A5edCD0295623e6dC557B5aBf3C",
      rewardToken: "0x9560e827aF36c94D2Ac33a39bCe1fe78631088dB",
    },
  },
};

/** Pure so tests can exercise selection without stubbing process.env + resetting modules. */
export function resolveProtocol(env: string | undefined): Protocol {
  return env === "velodrome" ? "velodrome" : "aerodrome";
}

export const PROTOCOL: Protocol = resolveProtocol(process.env.AERO_PROTOCOL);
export const PRESET: ProtocolPreset = PRESETS[PROTOCOL];

export const ADDRESSES = PRESET.addresses;
export const CHAIN = PRESET.chain;

// RPC_URL is protocol-agnostic and always wins if set. BASE_RPC_URL is kept
// for backward compatibility with existing aerodrome (the default) configs.
export const RPC_URL =
  process.env.RPC_URL ??
  (PROTOCOL === "aerodrome" ? process.env.BASE_RPC_URL : undefined) ??
  PRESET.defaultRpcUrl;

// Automatic failover if RPC_URL is down (not just rate-limited) — see
// data.ts's makeClient, which wires both into a viem fallback transport.
// Defaults to a different, independently-operated public RPC than
// defaultRpcUrl, so even a zero-config deployment gets real redundancy;
// override explicitly if you have a second dedicated provider.
export const RPC_URL_FALLBACK = process.env.RPC_URL_FALLBACK ?? PRESET.fallbackRpcUrl;

// Epochs: 1 week, starting Thursday 00:00 UTC (unix ts % WEEK == 0) — shared across the Velodrome family.
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
  /** How many top candidate pools (by staked TVL) get full epoch-history analysis. Comfortably above the
   * ~260 pools that currently clear minTvlUsd, so pools aren't silently excluded by TVL rank alone —
   * confirmed live that fetching history for all of them costs only ~10s, negligible against the pool-scan
   * itself (~1min, separately cached). Raise further if the pool count above minTvlUsd grows past this. */
  maxCandidates: Number(process.env.AERO_MAX_CANDIDATES ?? 300),
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
