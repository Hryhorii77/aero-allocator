import type { Address } from "viem";
import type { FeeEvent } from "./gauge-fees";

// A stored record of every NotifyFeesAmount release since it started being kept. Public RPCs only serve event logs
// ~10,000 blocks back, so a pace over days can't be read on demand; it has to be accumulated. An hourly job (and
// any read that finds the record stale) appends what happened since the last block it saw.

/** Blocks a single catch-up may reach back; a little under the public nodes' 10,000-block log lookback. */
export const MAX_LOOKBACK_BLOCKS = 9_500n;
/** Base produces a block every 2 seconds: 43,200 a day. */
const BLOCKS_PER_DAY = 43_200n;
/** Events older than this are dropped; the pace never looks further back than FEE_PACE_DAYS anyway. */
export const RETAIN_DAYS = 4;
export const FEE_PACE_DAYS = 2;

export interface LedgerEvent {
  /** Rewards contract, lowercase. */
  r: string;
  /** Fee token. */
  t: Address;
  /** Amount, base units, decimal string. */
  a: string;
  /** Block number. */
  b: number;
}

export interface Ledger {
  version: 1;
  /** First block every release from is recorded. Earlier history is not in the record. */
  coverageFrom: number;
  /** Last block read. */
  lastBlock: number;
  updatedAt: number;
  events: LedgerEvent[];
}

/** Where the next catch-up should read from. A gap longer than the lookback can't be filled, so it starts the record over. */
export function planRange(ledger: Ledger | null, head: bigint): { from: bigint; reset: boolean } {
  const floor = head - MAX_LOOKBACK_BLOCKS;
  if (!ledger) return { from: floor, reset: true };
  const next = BigInt(ledger.lastBlock) + 1n;
  if (next < floor) return { from: floor, reset: true };
  return { from: next, reset: false };
}

const keyOf = (e: LedgerEvent) => `${e.r}|${e.b}|${e.t}|${e.a}`;

/** Appends events read for from..to to the record (or starts it over), dropping duplicates and anything past retention. */
export function appendEvents(
  ledger: Ledger | null,
  fresh: Array<Pick<FeeEvent, "token" | "amount" | "blockNumber"> & { rewards: Address }>,
  range: { from: bigint; to: bigint; reset: boolean },
  nowMs: number,
): Ledger {
  const base: Ledger =
    ledger && !range.reset
      ? ledger
      : { version: 1, coverageFrom: Number(range.from), lastBlock: Number(range.from) - 1, updatedAt: nowMs, events: [] };
  const seen = new Set(base.events.map(keyOf));
  const added: LedgerEvent[] = [];
  for (const e of fresh) {
    const ev: LedgerEvent = { r: e.rewards.toLowerCase(), t: e.token, a: e.amount.toString(), b: Number(e.blockNumber) };
    const k = keyOf(ev);
    if (!seen.has(k)) {
      seen.add(k);
      added.push(ev);
    }
  }
  const lastBlock = Math.max(base.lastBlock, Number(range.to));
  const cutoff = lastBlock - Number(BLOCKS_PER_DAY) * RETAIN_DAYS;
  const events = [...base.events, ...added].filter((e) => e.b >= cutoff);
  return { version: 1, coverageFrom: Math.max(base.coverageFrom, cutoff), lastBlock, updatedAt: nowMs, events };
}

/** One rewards contract's releases within the pace window, as FeeEvents ready for feePace. */
export function eventsWithin(ledger: Ledger, rewards: string, headBlock: bigint, days = FEE_PACE_DAYS): Array<Pick<FeeEvent, "token" | "amount" | "blockNumber">> {
  const since = Number(headBlock - BLOCKS_PER_DAY * BigInt(days));
  const key = rewards.toLowerCase();
  return ledger.events
    .filter((e) => e.r === key && e.b >= Math.max(since, ledger.coverageFrom))
    .map((e) => ({ token: e.t, amount: BigInt(e.a), blockNumber: BigInt(e.b) }));
}

/** Hours of history the record holds, capped at the pace window. */
export function coverageHours(ledger: Ledger, headBlock: bigint, days = FEE_PACE_DAYS): number {
  const from = Math.max(ledger.coverageFrom, Number(headBlock - BLOCKS_PER_DAY * BigInt(days)));
  return Math.max(0, Number(headBlock) - from) / 1800;
}
