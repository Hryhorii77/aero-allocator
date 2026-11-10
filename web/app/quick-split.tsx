"use client";

import { useMemo, useState } from "react";
import type { GaugeFees } from "@/lib/gauge-fees-read";
import type { GaugeRow } from "@/lib/gauges";
import { gaugeLabel } from "@/lib/gauges";
import { aprPct, incentiveEndText, paceConfidence, rankByUsdPerDay } from "@/lib/gauge-yield";
import { projectRange } from "@/lib/projection";
import { DEFAULT_COOLDOWN_SEC, waitPhrase } from "@/lib/saero";
import { bestSplit, splitRate } from "@/lib/split";
import { btn, NOTE, NUM } from "./ui";
import { fmtApr } from "./allocation-desk";

/** Most gauges the quick view shows: few enough to follow by hand on a phone, and the best split rarely needs more. */
export const QUICK_PARTS = 3;
/**
 * The card's height with three pools (measured at 360 px on 2026-11-10: up to about 370 px once the label "… on Base" wraps onto two lines), held as
 * its minimum and by the loading placeholder, so the heading and chain buttons below don't jump when the card arrives or when a one-pool
 * card replaces a three-pool one. A card with extra lines ("incentives end in…") can still grow past it.
 */
export const QUICK_CARD_MIN_H = "min-h-[23.5rem]";
const CARD = "mt-4 rounded-xl border border-sky-900/60 bg-sky-950/20 px-3 py-3";
/** The phone's "more" button under the card (in the gauge table); the placeholder holds a copy so it is the same height. */
export const QUICK_MORE_LABEL = "more: explanations, all chains and every gauge";

/**
 * What the phone shows where the quick card will be while the gauges and fees load: the same box at the card's full height, so nothing
 * below moves when the card arrives. The caller removes it the moment a read fails.
 */
export function QuickSplitPlaceholder({ chainName }: { chainName?: string }) {
  return (
    <div aria-busy="true">
      <div className={`${CARD} ${QUICK_CARD_MIN_H}`}>
        {/* The card's own label, so it wraps the same way and the swap moves nothing. */}
        <div className="text-xs uppercase tracking-wide text-neutral-400">Best split for your amount{chainName ? ` on ${chainName}` : ""}</div>
        <p className={`mt-2 ${NOTE}`}>Reading fees from recent blocks…</p>
      </div>
      {/* An invisible copy of the "more" button the real block has under the card (its label wraps onto two lines at 360 px), so the swap
          moves nothing. */}
      <div className={`invisible mt-3 w-full ${btn("secondary", "md")}`} aria-hidden="true">
        {QUICK_MORE_LABEL}
      </div>
    </div>
  );
}
const usd2 = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * The phone's first answer: where this amount earns the most (up to three gauges), what it adds up to per day, how much to trust it,
 * and one button to the positions panel where the allocation is signed. The long explanations and the full table sit behind "more".
 */
export function QuickSplit({ gauges, fees, amount, cooldownSec, chainName }: { gauges: GaugeRow[]; fees: GaugeFees; amount: number; cooldownSec?: number; chainName?: string }) {
  const waitSec = cooldownSec ?? DEFAULT_COOLDOWN_SEC;
  // The clock for "incentives end in…": the fee data's own time, or the moment this card mounted when it has none.
  const [mountedMs] = useState(() => Date.now());
  const ranked = useMemo(() => rankByUsdPerDay(gauges, fees.fees, amount, undefined, { waitSec }), [gauges, fees, amount, waitSec]);
  const split = useMemo(
    () => bestSplit(ranked.map((r) => ({ gauge: r.gauge, symbol: gaugeLabel(r), rate: splitRate(r), weight: r.weight })), amount, QUICK_PARTS),
    [ranked, amount],
  );
  if (!(amount > 0) || !split) return null;

  const byGauge = new Map(ranked.map((r) => [r.gauge.toLowerCase(), r]));
  const rows = split.parts.map((p) => ({ part: p, y: byGauge.get(p.gauge.toLowerCase()) }));
  const weakest = rows.reduce((h, r) => Math.min(h, r.y?.windowHours ?? 0), Infinity);
  const spiky = rows.some((r) => r.y?.spike);
  const conf = spiky ? "spiky" : paceConfidence(weakest);
  const range = projectRange(ranked, split);
  const apr = aprPct(split.usdPerDay, amount, fees.aeroUsd);
  const nowSec = Math.floor((fees.generatedAt || mountedMs) / 1000);
  const ending = rows.map((r) => (r.y ? incentiveEndText(r.y, nowSec, waitSec) : null));

  return (
    <div className={`flex flex-col ${CARD} ${QUICK_CARD_MIN_H}`}>
      <div className="text-xs uppercase tracking-wide text-neutral-400">Best split for your amount{chainName ? ` on ${chainName}` : ""}</div>
      <div className={`mt-1 text-2xl font-semibold text-emerald-400 ${NUM}`}>
        ${usd2(split.usdPerDay)} <span className="text-sm font-normal text-neutral-400">a day{apr !== null ? ` · about ${fmtApr(apr)} APR` : ""}</span>
      </div>
      {range.lowUsdPerDay < range.paceUsdPerDay - 0.005 && (
        <p className="mt-0.5 text-sm text-neutral-300">
          Could be as low as <span className={`text-neutral-100 ${NUM}`}>${usd2(range.lowUsdPerDay)}</span> a day.
        </p>
      )}
      <ul className="mt-3 divide-y divide-neutral-800/80 text-sm">
        {rows.map((r, i) => (
          <li key={r.part.gauge} className="flex items-baseline justify-between gap-3 py-2">
            <span className="min-w-0">
              <span className="break-words text-neutral-100">{r.part.symbol}</span>
              {ending[i] && <span className="block text-xs text-amber-500">{ending[i]}</span>}
            </span>
            <span className={`shrink-0 text-right ${NUM}`}>
              <span className="text-neutral-100">{r.part.pct}%</span> <span className="text-neutral-400">${usd2(r.part.usdPerDay)}</span>
            </span>
          </li>
        ))}
      </ul>
      {rows.length === 1 && (
        <p className="mt-1 text-xs text-amber-500">All in one pool: the best estimate today, but it rests on one pool&rsquo;s pace.</p>
      )}
      <p className={`mt-2 ${NOTE}`}>
        Pace is <span className={conf === "solid" ? "text-emerald-400" : conf === "spiky" ? "text-amber-500" : "text-neutral-300"}>{conf}</span>
        {conf === "thin" || conf === "spiky" ? " (a few hours of fees, or a burst: it can fall)" : ""}. An estimate, not a promise. Moving restarts {waitPhrase(cooldownSec, "h")}.
      </p>
      {/* A shorter card keeps the full height with the space above its button, so the button stays where a three-pool card has it. */}
      <div className="flex-1" />
      <a href="#positions" className={`mt-3 flex w-full items-center justify-center text-center ${btn("primary", "md")}`}>
        allocate from my wallet
      </a>
    </div>
  );
}
