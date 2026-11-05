// Turning block numbers into time. Most chains keep one average block time, but a chain can change it at a known block (Base's Denim
// upgrade, 2026-11-05: one block every 2 s before, every 0.2 s after). The fee record holds four days of block numbers, so a span that
// crosses the switch must count each side at its own rate, or every age, window and bucket is off by up to 10x.

export interface BlockTime {
  /** Seconds per block now. */
  sec: number;
  /** The rate before a switch: blocks below `untilBlock` took `sec` seconds each. */
  before?: { untilBlock: number; sec: number };
}

/** A plain number is a chain whose block time never changed. */
export type BlockTimeLike = number | BlockTime;

const norm = (t: BlockTimeLike): BlockTime => (typeof t === "number" ? { sec: t } : t);

/** Seconds from block `a` to block `b` (negative when b < a). */
export function secondsBetween(t: BlockTimeLike, a: number | bigint, b: number | bigint): number {
  const from = Number(a);
  const to = Number(b);
  if (to < from) return -secondsBetween(t, to, from);
  const { sec, before } = norm(t);
  if (!before) return (to - from) * sec;
  const s = before.untilBlock;
  const oldBlocks = Math.max(0, Math.min(to, s) - from);
  const newBlocks = Math.max(0, to - Math.max(from, s));
  return oldBlocks * before.sec + newBlocks * sec;
}

/** The block `seconds` before block `head` (rounded to a whole block). */
export function blockSecondsBefore(t: BlockTimeLike, head: number | bigint, seconds: number): number {
  const h = Number(head);
  const { sec, before } = norm(t);
  if (!before || h <= before.untilBlock) {
    const rate = before && h <= before.untilBlock ? before.sec : sec;
    return Math.round(h - seconds / rate);
  }
  const afterSwitchSec = (h - before.untilBlock) * sec;
  if (seconds <= afterSwitchSec) return Math.round(h - seconds / sec);
  return Math.round(before.untilBlock - (seconds - afterSwitchSec) / before.sec);
}
