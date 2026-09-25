// Display formatting shared by the dashboard and the share-card route. Plain
// functions, no React — safe to import from server code.

/**
 * Cents are padded rather than trimmed, so $0.2 renders as "$0.20" — a
 * dropped trailing zero reads as a truncated number, and it reads as a
 * broken one at the size the Voter ROI hero prints it. Whole amounts stay
 * whole ("$42", not "$42.00"): the padding is there to finish a decimal,
 * not to add one. Past $1,000 cents stop carrying information at all.
 */
export const usd = (n: number) => {
  // Branch on what will actually be shown, not the raw input: 999.999
  // displays as 1,000, which belongs in the whole-dollar branch rather than
  // rendering "$1,000.00" right next to a "$1,000" one cent above it.
  const shown = Math.round(n * 100) / 100;
  return shown >= 1000
    ? `$${Math.round(shown).toLocaleString("en-US")}`
    : `$${shown.toLocaleString("en-US", {
        minimumFractionDigits: Number.isInteger(shown) ? 0 : 2,
        maximumFractionDigits: 2,
      })}`;
};

export function formatCountdown(ms: number): string {
  if (ms <= 0) return "epoch just flipped";
  const totalMin = Math.floor(ms / 60_000);
  const d = Math.floor(totalMin / (24 * 60));
  const h = Math.floor((totalMin % (24 * 60)) / 60);
  const m = totalMin % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
/** Voter.vote() reverts in the final hour before the epoch flips, so the real deadline to cast is an hour before the flip the clocks used to count to. */
export const VOTE_LOCK_MS = 60 * 60 * 1000;

/** Ms until voting locks for the epoch that started at `epochStartSec` (Unix seconds); <= 0 once it has. */
export function msUntilVoteLock(epochStartSec: number, nowMs: number = Date.now()): number {
  return epochStartSec * 1000 + WEEK_MS - VOTE_LOCK_MS - nowMs;
}
