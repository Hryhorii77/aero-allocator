// Shared control styles. Every button/chip in the dashboard goes through
// these so a color or padding change is one edit, not thirty.
//
// Color roles: sky = primary action / selected (copy weights, connect, cast), amber = caution,
// neutral = everything else. Emerald/rose otherwise mean positive/negative
// money only.
//
// Type scale (one place, so the live page reads as one voice). Sans for words, mono only for numbers, addresses and hashes
// (tabular, so columns line up). Nothing below text-xs (12px): the old 10-11px notes were unreadable on phones. Inputs are 16px
// on phones (iOS zooms the page on anything smaller) and 14px from `sm`.
//   H2    section title        text-base semibold
//   LEAD  intro under the h1   text-base
//   BODY  copy and table cells text-sm
//   NOTE  fine print, hints    text-xs
//   NUM   figures              mono + tabular-nums
//
// Corners: rounded-xl for cards and panels, rounded-lg for controls and the
// callouts nested inside a card.

type Variant = "primary" | "secondary" | "accent" | "warn" | "warnSolid";
type Size = "sm" | "md";

const BASE = "rounded-lg disabled:opacity-40";

const VARIANT: Record<Variant, string> = {
  primary: "border border-transparent bg-[var(--primary-bg)] text-[var(--primary-text)] hover:bg-[var(--primary-bg-hover)]",
  secondary: "border border-neutral-700 text-neutral-300 hover:border-neutral-500 hover:text-white",
  // Soft sky: stands out from the neutral row without competing with the filled primary.
  accent: "border border-sky-800 bg-sky-950/30 text-sky-300 hover:border-sky-600 hover:text-sky-200",
  warn: "border border-amber-800 bg-amber-950/40 text-amber-300 hover:border-amber-600",
  warnSolid: "border border-transparent bg-amber-700 text-white hover:bg-amber-600",
};

const SIZE: Record<Size, string> = {
  sm: "px-3 py-1.5 text-sm",
  md: "px-3 py-1.5 text-sm",
};

export function btn(variant: Variant = "secondary", size: Size = "md"): string {
  return `${BASE} ${VARIANT[variant]} ${SIZE[size]}`;
}

export const H2 = "text-base font-semibold text-neutral-100";
export const LEAD = "text-base leading-relaxed text-neutral-400";
export const BODY = "text-sm leading-relaxed text-neutral-300";
export const NOTE = "text-xs leading-relaxed text-neutral-400";
export const NUM = "font-mono tabular-nums";

/** Text input: 16px on phones (no iOS zoom), 14px from `sm`, red border when `invalid`. */
export function input(invalid = false, extra = ""): string {
  return `rounded-lg border bg-neutral-950 px-2.5 py-1.5 text-base text-neutral-200 placeholder:text-neutral-600 focus:outline-none sm:text-sm ${
    invalid ? "border-rose-600 focus:border-rose-500" : "border-neutral-700 focus:border-sky-600"
  } ${extra}`.trim();
}

/** Filter chip: sky when selected, quiet neutral otherwise. */
export function chip(active: boolean): string {
  return `shrink-0 rounded-lg border px-3 py-1.5 text-sm ${
    active
      ? "border-sky-600 bg-sky-950/40 text-sky-300"
      : "border-neutral-800 text-neutral-400 hover:border-neutral-600 hover:text-neutral-200"
  }`;
}

/** Every text link: sky, underlined on hover. (Pool names in the tables are row labels, not links in this sense.) */
export const LINK = "text-sky-400 underline-offset-2 hover:text-sky-300 hover:underline";
