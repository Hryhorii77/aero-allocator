import { parseAbiItem, type Address } from "viem";

// Fees that reached a gauge's voters, from the rewards contract's own NotifyFeesAmount events: each one is the
// exact token amount released to voters when the fee accumulator advanced. Fees still pending (not yet released)
// are added from the gauge's pendingFees minus what the rewards contract has already counted. Public RPCs refuse
// log queries over many contracts or long ranges, so reads are chunked (<= 5 addresses, <= 10,000 blocks).

export const notifyFeesEvent = parseAbiItem("event NotifyFeesAmount(address indexed _gauge, address indexed _token, uint256 _amount)");

export const ADDRESSES_PER_QUERY = 5;
export const BLOCKS_PER_QUERY = 10_000;
/** Base produces a block every 2 seconds. */
export const BLOCKS_PER_HOUR = 1800;

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

/** Public RPCs shed load with transient errors; retry with a growing pause before giving up. */
export async function withRetry<T>(fn: () => Promise<T>, attempts = 4, baseMs = 400): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      await new Promise((r) => setTimeout(r, baseMs * 2 ** i));
    }
  }
  throw last;
}

/** What the reader needs from a viem client (a chain-specific client is not assignable to the generic PublicClient). */
export interface LogReader {
  getLogs(args: {
    address: Address[];
    event: typeof notifyFeesEvent;
    fromBlock: bigint;
    toBlock: bigint;
  }): Promise<Array<{ address: Address; blockNumber: bigint; args: { _gauge?: Address; _token?: Address; _amount?: bigint } }>>;
}

/** Reads NotifyFeesAmount for the given rewards contracts, chunked and with bounded concurrency. */
export async function readFeeEvents(
  client: LogReader,
  rewards: Address[],
  fromBlock: bigint,
  toBlock: bigint,
  concurrency = 3,
): Promise<Array<FeeEvent & { rewards: Address }>> {
  const jobs = chunk(rewards, ADDRESSES_PER_QUERY).flatMap((addrs) => blockRanges(fromBlock, toBlock).map(([f, t]) => ({ addrs, f, t })));
  const out: Array<FeeEvent & { rewards: Address }> = [];
  let next = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const job = jobs[next++];
      const logs = await withRetry(() => client.getLogs({ address: job.addrs, event: notifyFeesEvent, fromBlock: job.f, toBlock: job.t }));
      for (const l of logs) out.push({ rewards: l.address, gauge: l.args._gauge!, token: l.args._token!, amount: l.args._amount!, blockNumber: l.blockNumber });
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, worker));
  return out;
}

/** Seconds per Base block. */
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
  blockSec: number = BLOCK_SEC,
): { usdPerDay: number; windowSec: number } | null {
  if (events.length === 0) return null;
  const first = events.reduce((m, e) => (e.blockNumber < m ? e.blockNumber : m), events[0].blockNumber);
  const later = events.filter((e) => e.blockNumber > first);
  if (later.length === 0) return null;
  const windowSec = Number(headBlock - first) * blockSec;
  if (windowSec < MIN_RATE_WINDOW_SEC) return null;
  return { usdPerDay: feesUsdPerDay(later, pending, windowSec, price), windowSec };
}
