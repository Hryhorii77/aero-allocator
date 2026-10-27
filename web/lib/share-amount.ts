/** The amount on a share card: the ?vp= a visitor put in the link, or 10,000 for a missing, junk, negative or absurd one. */
export function shareAmount(raw: string | null): number {
  const n = Number(raw);
  return n > 0 && n <= 1_000_000_000 ? Math.round(n) : 10_000;
}

/**
 * A position's power as it goes into a share link: two significant figures (9,734.6 becomes 9,700), so the link never carries an
 * exact balance. Null when the position is too small or too large for the card to take.
 */
export function roundedSharePower(power: number): number | null {
  if (!Number.isFinite(power) || power < 1) return null;
  const rounded = Math.round(Number(power.toPrecision(2)));
  return rounded >= 1 && rounded <= 1_000_000_000 ? rounded : null;
}

/** The card link for a position: the rounded power and the theme, nothing else (no token id, no address, no current gauges). */
export function positionCardPath(power: number, theme: "light" | "dark"): string | null {
  const vp = roundedSharePower(power);
  return vp === null ? null : `/api/share?vp=${vp}${theme === "light" ? "&theme=light" : ""}`;
}
