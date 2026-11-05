import { parseAbiItem, type Address } from "viem";
import { secondsBetween, type BlockTimeLike } from "./block-time";

// Fees that reached a gauge's voters, from the rewards contract's own NotifyFeesAmount events: each one is the
// exact token amount released to voters when the fee accumulator advanced. Fees still pending (not yet released)
// are added from the gauge's pendingFees minus what the rewards contract has already counted. Public RPCs refuse
// log queries over many contracts or long ranges, so reads are chunked (<= 5 addresses, <= 10,000 blocks by default, per chain in
// aero-chains.ts). A node that refuses a query as too large (a fallback node with a lower cap than the first one) gets it again in halves.

export const notifyFeesEvent = parseAbiItem("event NotifyFeesAmount(address indexed _gauge, address indexed _token, uint256 _amount)");

export const ADDRESSES_PER_QUERY = 5;
export const BLOCKS_PER_QUERY = 10_000;

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Inclusive [from, to] block ranges of at most `size` blocks covering from..to. */
export function blockRanges(from: bigint, to: bigint, size: bigint = BigInt(BLOCKS_PER_QUERY)): Array<[bigint, bigint]> {
  const out: Array<[bigint, bigint]> = [];
  for (let s = from; s <= to; s += size) out.push([s, s + size - 1n > to ? to : s + size - 1n]);
  return out;
}

export interface FeeEvent {
  gauge: Address;
  token: Address;
  amount: bigint;
  blockNumber: bigint;
}

type TokenPrice = { priceUsd: number; decimals: number } | null | undefined;

const usdOf = (token: Address, amount: bigint, price: (t: Address) => TokenPrice) => {
  const p = price(token);
  return p ? (Number(amount) / 10 ** p.decimals) * p.priceUsd : 0;
};

/** USD per day from released fees plus fees pending since the last release, over `windowSec` (>0). */
export function feesUsdPerDay(
  events: Array<Pick<FeeEvent, "token" | "amount">>,
  pending: Array<{ token: Address; amount: bigint }>,
  windowSec: number,
  price: (t: Address) => TokenPrice,
): number {
  if (windowSec <= 0) return 0;
  const released = events.reduce((a, e) => a + usdOf(e.token, e.amount, price), 0);
  const waiting = pending.reduce((a, p) => a + usdOf(p.token, p.amount < 0n ? 0n : p.amount, price), 0);
  return ((released + waiting) / windowSec) * 86_400;
}

/** Public RPCs shed load with transient errors; retry with a growing pause before giving up. `retry` false stops at once. */
export async function withRetry<T>(fn: () => Promise<T>, attempts = 4, baseMs = 400, retry: (e: unknown) => boolean = () => true): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      if (!retry(e)) break;
      await new Promise((r) => setTimeout(r, baseMs * 2 ** i));
    }
  }
  throw last;
}

/** The smallest block span a refused query is halved down to; below it the addresses are halved instead. */
export const MIN_SPAN = 1_000n;
// How nodes word "this query is too big": block range caps, result caps, address caps ("exceed maximum block range: 50000",
// "query exceeds max results 20000", "A maximum of 10 addresses is allowed", "block range is too large", "Log response size exceeded").
const TOO_BIG = /range|exceed|too (many|large|big)|max(imum)?|results|addresses|size|limit/i;
// …but a rate limit ("request limit reached", "Too Many Requests", 429) is a busy node, retried as before.
const RATE_LIMITED = /rate|request limit|too many requests|429|capacity/i;
// viem's full message also quotes the request body, so read only the node's own words (`details`) and the short message.
const errorText = (e: unknown) => {
  const x = e as { shortMessage?: string; details?: string; message?: string; cause?: { details?: string; shortMessage?: string } } | null;
  const parts = [x?.details, x?.cause?.details, x?.cause?.shortMessage].filter(Boolean);
  return (parts.length ? parts : [x?.message]).join(" ");
};
/** The refusal is about the number of addresses, so halving the addresses (not the blocks) is what helps. */
const isAddressCap = (e: unknown) => /address/i.test(errorText(e));
export const isTooBig = (e: unknown) => {
  const t = errorText(e);
  return TOO_BIG.test(t) && !RATE_LIMITED.test(t);
};

/** What the reader needs from a viem client (a chain-specific client is not assignable to the generic PublicClient). */
export interface LogReader {
  getLogs(args: {
    address: Address[];
    event: typeof notifyFeesEvent;
    fromBlock: bigint;
    toBlock: bigint;
  }): Promise<Array<{ address: Address; blockNumber: bigint; args: { _gauge?: Address; _token?: Address; _amount?: bigint } }>>;
}

/**
 * Reads NotifyFeesAmount for the given rewards contracts, chunked and with bounded concurrency. A query refused as too big is split in
 * half (the addresses when the node names them, else blocks down to MIN_SPAN, then addresses) and the smaller size is kept for the rest
 * of the read, so a fallback node with a lower cap costs a few refusals, not one per query.
 */
export async function readFeeEvents(
  client: LogReader,
  rewards: Address[],
  fromBlock: bigint,
  toBlock: bigint,
  concurrency = 3,
  limits: { span?: number; addresses?: number } = {},
): Promise<Array<FeeEvent & { rewards: Address }>> {
  let span = BigInt(limits.span ?? BLOCKS_PER_QUERY);
  const jobs = chunk(rewards, limits.addresses ?? ADDRESSES_PER_QUERY).flatMap((addrs) => blockRanges(fromBlock, toBlock, span).map(([f, t]) => ({ addrs, f, t })));
  const out: Array<FeeEvent & { rewards: Address }> = [];
  let addrCap = Infinity;
  const read = async (addrs: Address[], f: bigint, t: bigint): Promise<void> => {
    if (addrs.length > addrCap) {
      for (const part of chunk(addrs, addrCap)) await read(part, f, t);
      return;
    }
    if (t - f + 1n > span) {
      for (const [a, b] of blockRanges(f, t, span)) await read(addrs, a, b);
      return;
    }
    let logs: Awaited<ReturnType<LogReader["getLogs"]>>;
    try {
      logs = await withRetry(() => client.getLogs({ address: addrs, event: notifyFeesEvent, fromBlock: f, toBlock: t }), 4, 400, (e) => !isTooBig(e));
    } catch (e) {
      if (!isTooBig(e)) throw e;
      const blocks = t - f + 1n;
      if (isAddressCap(e) && addrs.length > 1) {
        const mid = Math.ceil(addrs.length / 2);
        if (mid < addrCap) addrCap = mid;
        await read(addrs.slice(0, mid), f, t);
        await read(addrs.slice(mid), f, t);
        return;
      }
      if (blocks > MIN_SPAN) {
        const half = blocks / 2n > MIN_SPAN ? blocks / 2n : MIN_SPAN;
        if (half < span) span = half;
        return read(addrs, f, t);
      }
      if (addrs.length > 1) {
        const mid = Math.ceil(addrs.length / 2);
        await read(addrs.slice(0, mid), f, t);
        await read(addrs.slice(mid), f, t);
        return;
      }
      throw e;
    }
    for (const l of logs) out.push({ rewards: l.address, gauge: l.args._gauge!, token: l.args._token!, amount: l.args._amount!, blockNumber: l.blockNumber });
  };
  let next = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const job = jobs[next++];
      await read(job.addrs, job.f, job.t);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, worker));
  return out;
}

/** The fallback seconds per block (Base before Denim); callers pass their chain's blockTime. */
export const BLOCK_SEC = 2;
/** Shortest stretch a rate is quoted over: a few minutes of fees say nothing about the next 47 hours. */
export const MIN_RATE_WINDOW_SEC = 3600;

/**
 * Fee pace for one gauge that cannot be fooled by a gauge's first release. Fees pile up in the pool before anyone
 * votes, and the first release after voters arrive dumps them all at once, covering an unknown stretch of time. So
 * the first release in the window is dropped and everything after it (later releases plus fees still pending) is
 * divided by the time since it. Returns null when there is no release after that point to measure or the stretch is
 * shorter than MIN_RATE_WINDOW_SEC: unknown, not zero.
 */
export function feePace(
  events: Array<Pick<FeeEvent, "token" | "amount" | "blockNumber">>,
  pending: Array<{ token: Address; amount: bigint }>,
  headBlock: bigint,
  price: (t: Address) => TokenPrice,
  blockSec: BlockTimeLike = BLOCK_SEC,
): { usdPerDay: number; windowSec: number } | null {
  if (events.length === 0) return null;
  const first = events.reduce((m, e) => (e.blockNumber < m ? e.blockNumber : m), events[0].blockNumber);
  const later = events.filter((e) => e.blockNumber > first);
  if (later.length === 0) return null;
  const windowSec = secondsBetween(blockSec, first, headBlock);
  if (windowSec < MIN_RATE_WINDOW_SEC) return null;
  return { usdPerDay: feesUsdPerDay(later, pending, windowSec, price), windowSec };
}
