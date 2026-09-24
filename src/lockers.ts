/**
 * Enumerates every veNFT in the system with its size and current vote split.
 *
 * Why this exists: the revenue question ("will anyone pay for a better vote
 * split?") is usually answered with a guess. It doesn't have to be. The
 * entire customer list is on-chain — every lock, its size, and exactly how
 * it voted — so the addressable market is computable rather than assumed.
 * scripts/lockers.ts runs this and prices each one against the current
 * recommendation.
 *
 * Enumeration is via veSugar's all(limit, offset), where offset is a
 * starting token id, NOT an index — ids are sparse (burned/merged locks
 * leave holes) and the contract returns whatever exists in that id window.
 */
import { parseAbi } from "viem";
import { ADDRESSES } from "./config.js";
import { getClient, withRetry } from "./data.js";
import type { CurrentVoteWeight } from "./position.js";

// Subset of velodrome-finance/sugar's VeSugar.vy VeNFT struct. Kept in sync
// with web/lib/voter.ts's copy — that one is for a single account's locks in
// the browser, this one for the full sweep server-side.
const veSugarAbi = parseAbi([
  "struct LpVotes { address lp; uint256 weight; }",
  "struct VeNFT { uint256 id; address account; uint8 decimals; uint128 amount; uint256 voting_amount; uint256 governance_amount; uint256 rebase_amount; uint256 expires_at; uint256 voted_at; LpVotes[] votes; address token; bool permanent; uint256 delegate_id; uint256 managed_id; }",
  "function all(uint256 _limit, uint256 _offset) view returns (VeNFT[])",
  "function byAccount(address _account) view returns (VeNFT[])",
]);

const votingEscrowAbi = parseAbi(["function tokenId() view returns (uint256)"]);
const voterAbi = parseAbi(["function ve() view returns (address)"]);

/**
 * veSugar.all() builds its whole return array in one eth_call, so the page
 * size is bounded by the node's call gas budget rather than by the contract.
 * Measured against Base public RPCs: 50 succeeds in sparse id ranges, 100
 * reverts everywhere, and even 50 reverts in dense ranges where many locks
 * carry long `votes` arrays. Hence fetchLockerRange's split-on-revert below,
 * the same tactic data.ts uses for LpSugar's equivalent limit.
 */
export const LOCKER_PAGE_SIZE = 50;

/** Below this, a revert is the node refusing, not the page being too big. */
const MIN_PAGE_SIZE = 5;

/**
 * Whether a failure is the contract/node rejecting this call's size (retrying
 * it unchanged is futile) rather than a transient transport problem (retrying
 * is exactly right). Matched on the message because viem wraps the revert in
 * several error classes depending on transport, and the distinction here only
 * needs to steer retry-vs-split.
 */
function isRevert(e: unknown): boolean {
  return /revert|out of gas|exceeds|too large/i.test(e instanceof Error ? e.message : String(e));
}

export interface Locker {
  tokenId: string;
  account: string;
  /** Voting power in veAERO (voting_amount, decimals applied). */
  votingPower: number;
  /** Current on-chain split, each weight as a % of this NFT's own total. */
  votes: CurrentVoteWeight[];
  /** Unix seconds; 0 for permanent locks. */
  expiresAt: number;
  permanent: boolean;
}

export interface LockerScan {
  lockers: Locker[];
  /** Highest token id minted — the ceiling the sweep walked to. */
  maxTokenId: number;
  /** Id windows that never came back, even after the straggler pass. */
  failedOffsets: number[];
}

type RawVeNft = {
  id: bigint;
  account: `0x${string}`;
  decimals: number;
  amount: bigint;
  voting_amount: bigint;
  expires_at: bigint;
  voted_at: bigint;
  votes: readonly { lp: `0x${string}`; weight: bigint }[];
  permanent: boolean;
};

/**
 * LpVotes.weight is relative, not a fixed scale (the same convention
 * Voter.vote() uses), so it's normalized to a percentage of this NFT's own
 * total to be directly comparable with a recommended split's weightPct.
 * BigInt math until the final divide, matching web/app/wallet.tsx's
 * identical conversion — the two must not drift, or the dashboard and this
 * sweep would disagree about the same lock's current split.
 */
export function normalizeVotes(
  votes: readonly { lp: `0x${string}`; weight: bigint }[],
): CurrentVoteWeight[] {
  const totalWeight = votes.reduce((s, v) => s + v.weight, 0n);
  if (totalWeight === 0n) return [];
  return votes.map((v) => ({
    pool: v.lp,
    weightPct: Number((v.weight * 10_000n) / totalWeight) / 100,
  }));
}

async function readLockerPage(limit: number, offset: number): Promise<readonly RawVeNft[]> {
  const c = getClient();
  return (await c.readContract({
    address: ADDRESSES.veSugar,
    abi: veSugarAbi,
    functionName: "all",
    args: [BigInt(limit), BigInt(offset)],
  })) as readonly RawVeNft[];
}

/**
 * One page, halving the request on revert rather than only backing off.
 *
 * Dense id ranges (many locks, each with a long votes array) deterministically
 * blow the eth_call gas budget at limit=50 — retrying the same call just fails
 * again more slowly, which is what made the first full sweep crawl. Same
 * tactic and reasoning as data.ts's fetchLpPage; only leaf-sized ranges get
 * the full retry treatment.
 *
 * `limit` is a count of RESULTS, not a span of ids (veSugar walks upward from
 * `offset` collecting existing locks and skipping burned ones), so the second
 * half has to resume from the last id actually returned, not from a computed
 * id boundary.
 */
async function fetchLockerRange(limit: number, offset: number): Promise<RawVeNft[]> {
  if (limit <= MIN_PAGE_SIZE) return [...(await withRetry(() => readLockerPage(limit, offset), 3))];

  try {
    return [...(await readLockerPage(limit, offset))];
  } catch (e) {
    // A revert is deterministic: this page is over the node's call gas budget
    // and re-issuing the identical call cannot succeed. Splitting immediately
    // — rather than sleeping through withRetry's 1s + 2s backoff first — is
    // what makes a full sweep take minutes instead of hours, since the dense
    // low-id ranges revert on nearly every page. A non-revert (rate limit,
    // dropped connection) is the opposite: same size, worth waiting out.
    if (!isRevert(e)) {
      try {
        return [...(await withRetry(() => readLockerPage(limit, offset), 2))];
      } catch {
        // Persistent even after backoff — fall through and try smaller.
      }
    }
    const half = Math.max(MIN_PAGE_SIZE, Math.floor(limit / 2));
    const first = await fetchLockerRange(half, offset);
    const remaining = limit - first.length;
    if (first.length === 0 || remaining <= 0) return first;
    const resumeAt = Number(first[first.length - 1].id) + 1;
    return [...first, ...(await fetchLockerRange(remaining, resumeAt))];
  }
}

function toLocker(raw: RawVeNft): Locker {
  return {
    tokenId: raw.id.toString(),
    account: raw.account,
    votingPower: Number(raw.voting_amount) / 10 ** raw.decimals,
    votes: normalizeVotes(raw.votes),
    expiresAt: Number(raw.expires_at),
    permanent: raw.permanent,
  };
}

/**
 * Every lock held by one account, with its current split — the single-wallet
 * read behind /api/v1/position.
 *
 * Zero-power locks are dropped (expired, fully withdrawn, or burned): they
 * can't vote, so including them would dilute the blended split against
 * voting power that doesn't exist.
 */
export async function fetchAccountLocks(account: `0x${string}`): Promise<Locker[]> {
  const c = getClient();
  const raws = (await withRetry(
    () =>
      c.readContract({
        address: ADDRESSES.veSugar,
        abi: veSugarAbi,
        functionName: "byAccount",
        args: [account],
      }),
    3,
  )) as readonly RawVeNft[];
  return raws.filter((r) => r.voting_amount > 0n).map(toLocker);
}

/** Highest minted token id, read from the VotingEscrow the Voter points at. */
export async function fetchMaxTokenId(): Promise<number> {
  const c = getClient();
  const ve = (await c.readContract({
    address: ADDRESSES.voter,
    abi: voterAbi,
    functionName: "ve",
    args: [],
  })) as `0x${string}`;
  return Number(
    await c.readContract({ address: ve, abi: votingEscrowAbi, functionName: "tokenId", args: [] }),
  );
}

/**
 * Sweeps every token id and returns the locks at or above `minVotingPower`.
 *
 * The filter is applied during the sweep rather than after, because the
 * overwhelming majority of ids are dust or burned and holding 130k+ structs
 * (each with its own votes array) in memory to discard them is pointless.
 *
 * `onProgress` exists because this is a multi-minute job against public
 * RPCs; a script that prints nothing for four minutes is indistinguishable
 * from one that has hung.
 */
export async function fetchLockers(opts: {
  minVotingPower: number;
  concurrency?: number;
  maxTokenId?: number;
  onProgress?: (done: number, total: number, found: number) => void;
}): Promise<LockerScan> {
  const { minVotingPower, concurrency = 4, onProgress } = opts;
  const maxTokenId = opts.maxTokenId ?? (await fetchMaxTokenId());

  const offsets: number[] = [];
  for (let id = 1; id <= maxTokenId; id += LOCKER_PAGE_SIZE) offsets.push(id);

  // Keyed by tokenId, NOT appended to a list: because `limit` counts results
  // and burned ids are skipped, a page starting at id N returns `limit` locks
  // spanning *more* than `limit` ids — so stepping offsets by LOCKER_PAGE_SIZE
  // guarantees full coverage but also overlaps into the next page's range.
  // Appending would double-count every lock in the overlap and inflate the
  // market size, which is the one direction of error this whole sweep exists
  // to avoid. Stepping by the page size is still correct for coverage: a page
  // returning `limit` distinct ids >= offset must reach at least offset+limit-1.
  const byTokenId = new Map<string, Locker>();
  const failedOffsets: number[] = [];
  let cursor = 0;
  let done = 0;

  const take = (raws: readonly RawVeNft[]) => {
    for (const raw of raws) {
      if (Number(raw.voting_amount) / 10 ** raw.decimals < minVotingPower) continue;
      const locker = toLocker(raw);
      byTokenId.set(locker.tokenId, locker);
    }
  };

  const workers = Array.from({ length: concurrency }, async () => {
    while (cursor < offsets.length) {
      const offset = offsets[cursor++];
      try {
        take(await fetchLockerRange(LOCKER_PAGE_SIZE, offset));
      } catch {
        failedOffsets.push(offset);
      }
      onProgress?.(++done, offsets.length, byTokenId.size);
    }
  });
  await Promise.all(workers);

  // Same reasoning as data.ts's page sweep: retry stragglers sequentially
  // once the parallel burst's rate-limit pressure is over. A missing window
  // here silently drops whole lockers, which would understate the market —
  // the other direction of error this script exists to avoid.
  const stillFailed: number[] = [];
  for (const offset of failedOffsets) {
    try {
      take(await fetchLockerRange(LOCKER_PAGE_SIZE, offset));
    } catch {
      stillFailed.push(offset);
    }
  }

  const lockers = [...byTokenId.values()].sort((a, b) => b.votingPower - a.votingPower);
  return { lockers, maxTokenId, failedOffsets: stillFailed };
}
