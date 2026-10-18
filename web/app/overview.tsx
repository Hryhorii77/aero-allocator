"use client";

import { btn } from "./ui";
import type { MobileTab } from "./mobile-tabs";
import type { NextMove } from "@/lib/next-move";

export interface OverviewRow {
  pool: string;
  symbol: string;
  weightPct: number;
  expectedRewardUsd?: number;
}

/** Phone landing tab: the answer in one glance. Presentational only; page.tsx owns the numbers so
 * this cannot disagree with the Vote tab or the share card. */
export function OverviewPanel({
  votingPower,
  veSymbol,
  headlineText,
  headlineCaption,
  rows,
  move,
  closeText,
  onGo,
  active,
}: {
  votingPower: number;
  veSymbol: string;
  headlineText: string;
  headlineCaption: string;
  rows: OverviewRow[];
  move: NextMove;
  closeText: string | null;
  onGo: (t: MobileTab) => void;
  active: boolean;
}) {
  const top = rows.slice(0, 4);
  const maxW = Math.max(1, ...top.map((r) => r.weightPct));
  const warn = move.tone === "warn";
  return (
    <section aria-label="overview" className={`mb-10 sm:hidden ${active ? "" : "hidden"}`}>
      <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-4">
        <div className="text-xs uppercase tracking-wider text-neutral-500">Your allocation</div>
        <div className="mt-1 font-mono text-4xl tabular-nums text-emerald-400">{headlineText}</div>
        <p className="mt-1 text-xs text-neutral-400">
          {headlineCaption} for {votingPower.toLocaleString("en-US")} {veSymbol}
        </p>
        {closeText && <p className="mt-1 font-mono text-xs text-neutral-500">{closeText}</p>}
        {top.length > 0 && (
          <ul className="mt-4 space-y-2.5" aria-label="top pools in the recommended split">
            {top.map((r) => (
              <li key={r.pool}>
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="min-w-0 truncate text-neutral-200">{r.symbol}</span>
                  <span className="shrink-0 font-mono tabular-nums text-neutral-300">{r.weightPct.toFixed(1)}%</span>
                </div>
                <div className="mt-1 h-1.5 rounded-full bg-neutral-800" aria-hidden="true">
                  <div className="h-1.5 rounded-full bg-emerald-500" style={{ width: `${(r.weightPct / maxW) * 100}%` }} />
                </div>
              </li>
            ))}
          </ul>
        )}
        <button type="button" onClick={() => onGo("vote")} className={`mt-4 w-full ${btn("primary")}`}>
          copy the full split
        </button>
      </div>

      <div
        className={`mt-4 rounded-xl border p-4 ${
          warn ? "border-amber-800 bg-amber-950/30" : "border-sky-900/60 bg-sky-950/30"
        }`}
      >
        <div className={`text-xs uppercase tracking-wider ${warn ? "text-amber-400" : "text-sky-400"}`}>
          {warn ? "Next best move · deadline" : "Next best move"}
        </div>
        <div className="mt-1 text-base font-semibold text-neutral-100">{move.title}</div>
        <p className="mt-1 text-sm text-neutral-300">{move.body}</p>
        {move.go && move.cta && (
          <button type="button" onClick={() => onGo(move.go as MobileTab)} className={`mt-3 ${btn(warn ? "warn" : "secondary")}`}>
            {move.cta}
          </button>
        )}
      </div>
    </section>
  );
}
