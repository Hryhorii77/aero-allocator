import { parseAbi, type Address } from "viem";

// What a position has earned and not yet claimed, read from Aero's per-gauge rewards managers (client-safe: only ABIs and arithmetic).
// Source: dromos-labs/metadex-public, V3/src/rewards/VotingRewardsManager.sol, `earnedFees(tokenId, maxCheckpoints)` returns the
// unclaimed amounts of the pool's two fee tokens. Incentives are separate (per program) and are not counted here.

export const registryRewardsAbi = parseAbi(["function gaugeToRewards(address) view returns (address)"]);
export const rewardsManagerAbi = parseAbi([
  "function earnedFees(uint256 tokenId, uint256 maxCheckpoints) view returns (uint256, uint256)",
  "function token0() view returns (address)",
  "function token1() view returns (address)",
]);
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

/** Adds up earned amounts per token across gauges, values them, and drops dust-free zero lines. */
export function summariseEarned(entries: EarnedEntry[], meta: Map<string, TokenMeta>, prices: Record<string, number>): EarnedSummary {
  const raw = new Map<string, bigint>();
  for (const e of entries) {
    for (const [token, amount] of [[e.token0, e.amount0], [e.token1, e.amount1]] as const) {
      if (amount > 0n) raw.set(token.toLowerCase(), (raw.get(token.toLowerCase()) ?? 0n) + amount);
    }
  }
  const lines: EarnedLine[] = [];
  for (const [token, amount] of raw) {
    const m = meta.get(token);
    if (!m) continue;
    const whole = Number(amount) / 10 ** m.decimals;
    const price = prices[token];
    lines.push({ token: token as Address, symbol: m.symbol, amount: whole, usd: price ? whole * price : null });
  }
  lines.sort((a, b) => (b.usd ?? -1) - (a.usd ?? -1));
  return { lines, totalUsd: lines.reduce((a, l) => a + (l.usd ?? 0), 0), unpriced: lines.some((l) => l.usd === null) };
}
