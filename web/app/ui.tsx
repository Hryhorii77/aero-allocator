// Shared control styles. Every button/chip in the dashboard goes through
// these so a color or padding change is one edit, not thirty.
//
// Color roles: sky = primary action / selected (copy weights, connect, cast), amber = caution,
// neutral = everything else. Emerald/rose otherwise mean positive/negative
// money only.
//
// Corners: rounded-xl for cards and panels, rounded-lg for controls and the
// callouts nested inside a card.

type Variant = "primary" | "secondary" | "warn" | "warnSolid";
type Size = "sm" | "md";

const BASE = "rounded-lg disabled:opacity-40";

const VARIANT: Record<Variant, string> = {
  primary: "bg-sky-600 text-white hover:bg-sky-500",
  secondary: "border border-neutral-700 text-neutral-300 hover:border-neutral-500 hover:text-white",
  warn: "border border-amber-800 bg-amber-950/40 text-amber-300 hover:border-amber-600",
  warnSolid: "bg-amber-700 text-white hover:bg-amber-600",
};

const SIZE: Record<Size, string> = {
  sm: "px-2.5 py-1 text-xs",
  md: "px-3 py-1.5 text-sm",
};

export function btn(variant: Variant = "secondary", size: Size = "md"): string {
  return `${BASE} ${VARIANT[variant]} ${SIZE[size]}`;
}

/** Filter chip: sky when selected, quiet neutral otherwise. */
export function chip(active: boolean): string {
  return `shrink-0 rounded-lg border px-2.5 py-1 font-mono text-xs ${
    active
      ? "border-sky-600 bg-sky-950/40 text-sky-300"
      : "border-neutral-800 text-neutral-400 hover:border-neutral-600 hover:text-neutral-200"
  }`;
}

export const LINK = "text-sky-400 hover:text-sky-300";
