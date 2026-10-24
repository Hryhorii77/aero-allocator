/** "just now", "12 min ago", "3 h ago", "2 d ago" for a time in the past (ms since epoch). */
export function ago(thenMs: number, nowMs: number = Date.now()): string {
  const min = Math.max(0, Math.floor((nowMs - thenMs) / 60_000));
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} h ago`;
  return `${Math.floor(hr / 24)} d ago`;
}
