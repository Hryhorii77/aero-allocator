/** The amount on a share card: the ?vp= a visitor put in the link, or 10,000 for a missing, junk, negative or absurd one. */
export function shareAmount(raw: string | null): number {
  const n = Number(raw);
  return n > 0 && n <= 1_000_000_000 ? Math.round(n) : 10_000;
}
