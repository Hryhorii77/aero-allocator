/**
 * A change to power on another chain takes minutes to arrive, and a second one sent meanwhile would be held by the chain's wait and
 * applied late. After a send the page remembers it for a while, in this browser only, and blocks another for the same position and chain.
 * Storage can be blocked or empty (private window), so every access is guarded and the page works without it.
 */
export const PENDING_LOCK_MS = 15 * 60_000;
const key = (tokenId: bigint, chainId: number) => `aero-pending-${tokenId}-${chainId}`;

export function setPending(tokenId: bigint, chainId: number, now = Date.now()): void {
  try {
    localStorage.setItem(key(tokenId, chainId), String(now));
  } catch {
    /* storage unavailable: the in-flight check against the chains still applies */
  }
}

/** Milliseconds left on the lock, 0 when there is none. */
export function pendingLeftMs(tokenId: bigint, chainId: number, now = Date.now()): number {
  try {
    const at = Number(localStorage.getItem(key(tokenId, chainId)));
    return at > 0 ? Math.max(0, at + PENDING_LOCK_MS - now) : 0;
  } catch {
    return 0;
  }
}
