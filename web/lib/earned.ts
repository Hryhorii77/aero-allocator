import { parseAbi, type Address } from "viem";

// What a position has earned and not yet claimed, read from Aero's per-gauge rewards managers (client-safe: only ABIs and arithmetic).
// Source: dromos-labs/metadex-public, V3/src/rewards/VotingRewardsManager.sol, `earnedFees(tokenId, maxCheckpoints)` returns the
// unclaimed amounts of the pool's two fee tokens, and `earnedIncentives(tokenId, programId, maxCheckpoints)` one incentive program's
// unclaimed amount (programs are numbered 1..incentiveCount() on each gauge's manager, `incentive(id)` gives the token). Both include the
// part not yet checkpointed, so they match what a claim would pay now.

export const registryRewardsAbi = parseAbi(["function gaugeToRewards(address) view returns (address)"]);
export const rewardsManagerAbi = parseAbi([
  "function earnedFees(uint256 tokenId, uint256 maxCheckpoints) view returns (uint256, uint256)",
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function earnedIncentives(uint256 tokenId, uint256 programId, uint256 maxCheckpoints) view returns (uint256)",
  "function incentiveCount() view returns (uint256)",
  "function incentive(uint256) view returns ((address token, uint256 amount, uint256 rate, uint48 start, uint48 end, address creator))",
]);

/** Incentive programs read per gauge, newest first: a gauge with more has its older ones left out (and the total says "at least"). */
export const MAX_PROGRAMS_PER_GAUGE = 60;
export const erc20MetaAbi = parseAbi(["function decimals() view returns (uint8)", "function symbol() view returns (string)"]);

/** Upper bound on the checkpoints one read walks; a position that changed gauges many times may have more unclaimed than this reads. */
export const MAX_CHECKPOINTS = 100n;

export interface EarnedEntry {
  gauge: Address;
  token0: Address;
  token1: Address;
  amount0: bigint;
  amount1: bigint;
}

export interface TokenMeta {
  decimals: number;
  symbol: string;
}

export interface EarnedLine {
  token: Address;
  symbol: string;
  /** Whole tokens. */
  amount: number;
  /** null when the token has no price. */
  usd: number | null;
}

export interface EarnedSummary {
  lines: EarnedLine[];
  /** Sum of the priced lines. */
  totalUsd: number;
  /** True when some earned token has no price, so the total is a floor. */
  unpriced: boolean;
}

/** Adds up earned amounts per token across gauges, values them, and drops zero lines. */
export function summariseEarned(entries: EarnedEntry[], meta: Map<string, TokenMeta>, prices: Record<string, number>): EarnedSummary {
  return summariseAmounts(
    entries.flatMap((e) => [
      { token: e.token0, amount: e.amount0 },
      { token: e.token1, amount: e.amount1 },
    ]),
    meta,
    prices,
  );
}

/** The same for any list of (token, amount) pairs, e.g. incentive programs. A token with no metadata is left out. */
export function summariseAmounts(pairs: Array<{ token: Address; amount: bigint }>, meta: Map<string, TokenMeta>, prices: Record<string, number>): EarnedSummary {
  const raw = new Map<string, bigint>();
  for (const { token, amount } of pairs) if (amount > 0n) raw.set(token.toLowerCase(), (raw.get(token.toLowerCase()) ?? 0n) + amount);
  const lines: EarnedLine[] = [];
  for (const [token, amount] of raw) {
    const m = meta.get(token);
    if (!m) continue;
    const whole = Number(amount) / 10 ** m.decimals;
    const price = prices[token];
    const value = price ? whole * price : null;
    // Dust that would print as "0 TOKEN": under a millionth of a token and worth less than half a cent (or unpriced).
    if (whole < 5e-7 && (value ?? 0) < 0.005) continue;
    lines.push({ token: token as Address, symbol: m.symbol, amount: whole, usd: value });
  }
  lines.sort((a, b) => (b.usd ?? -1) - (a.usd ?? -1));
  return { lines, totalUsd: lines.reduce((a, l) => a + (l.usd ?? 0), 0), unpriced: lines.some((l) => l.usd === null) };
}

/** One chain's unclaimed earnings for a position: fees and incentives on the gauges it sits on there now. */
export interface EarnedChain {
  chainId: number;
  name: string;
  fees: EarnedSummary;
  incentives: EarnedSummary;
  totalUsd: number;
  unpriced: boolean;
}

export interface EarnedAll {
  /** Chains with anything unclaimed, largest first. */
  chains: EarnedChain[];
  totalUsd: number;
  /** Some earned token has no price, or older incentive programs were left out: the total is a floor. */
  atLeast: boolean;
  /** Chains whose reads failed just now. */
  skipped: string[];
}

export function chainTotal(chainId: number, name: string, fees: EarnedSummary, incentives: EarnedSummary): EarnedChain {
  return { chainId, name, fees, incentives, totalUsd: fees.totalUsd + incentives.totalUsd, unpriced: fees.unpriced || incentives.unpriced };
}

export function combineChains(chains: EarnedChain[], skipped: string[], truncated: boolean): EarnedAll {
  const kept = chains.filter((c) => c.fees.lines.length + c.incentives.lines.length > 0).sort((a, b) => b.totalUsd - a.totalUsd);
  return { chains: kept, totalUsd: kept.reduce((s, c) => s + c.totalUsd, 0), atLeast: truncated || kept.some((c) => c.unpriced), skipped };
}
