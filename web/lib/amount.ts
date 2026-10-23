/** The most sAERO anyone could plausibly type; above it the box asks for a smaller number. */
export const MAX_AMOUNT = 1_000_000_000;

export type AmountResult = { ok: true; value: number } | { ok: false; error: string };

/** A typed sAERO amount: digits with optional commas, spaces and one decimal point; no signs, no letters, above zero. */
export function parseAmount(text: string): AmountResult {
  const t = text.trim().replace(/[,\s]/g, "");
  if (t === "") return { ok: false, error: "Enter how much sAERO you hold." };
  if (!/^\d*\.?\d+$/.test(t)) return { ok: false, error: "Numbers only, for example 10,000." };
  const value = Number(t);
  if (!(value > 0)) return { ok: false, error: "Enter an amount above zero." };
  if (value > MAX_AMOUNT) return { ok: false, error: "That is more sAERO than exists. Enter a smaller amount." };
  return { ok: true, value };
}
