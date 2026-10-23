"use client";

import { useMemo } from "react";
import type { GaugeRow } from "@/lib/gauges";
import type { GaugeFees } from "@/lib/gauge-fees-read";
import { aprPct, MIN_RANK_WEIGHT, paceConfidence, rankByUsdPerDay } from "@/lib/gauge-yield";
import { bestSplit } from "@/lib/split";
import { gaugeLabel } from "@/lib/gauges";
import { NOTE, NUM } from "./ui";

const LOCK_HOURS = 47;
/** "27%" for ordinary figures, "1.2k%" for the absurd ones a tiny gauge can show. */
export const fmtApr = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k%` : `${n.toFixed(n < 10 ? 1 : 0)}%`);
const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 0 });
const usd2 = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function Card({ value, label, tone }: { value: string; label: string; tone?: "good" }) {
  return (
    <div className="min-w-0 rounded-lg border border-neutral-800 px-3 py-2.5">
      <div className={`text-lg font-semibold ${/^[$+\d]/.test(value) ? NUM : ""} ${tone === "good" ? "text-emerald-400" : "text-neutral-100"}`}>{value}</div>
      <div className="mt-0.5 text-xs leading-snug text-neutral-500">{label}</div>
    </div>
  );
}

/**
 * What an amount of sAERO earns per day on one chain: the best way to split it across gauges (each gauge you join dilutes
 * the next, so the best answer is usually several), how that compares with going all-in on the top gauge, what it adds up
 * to over the 47-hour lock, and how much history each estimate rests on.
 */
export function AllocationDesk({ gauges, fees, amount }: { gauges: GaugeRow[]; fees: GaugeFees; amount: number }) {
  const apr = (usd: number) => aprPct(usd, amount, fees.aeroUsd);
  const ranked = useMemo(() => rankByUsdPerDay(gauges, fees.fees, amount), [gauges, fees, amount]);
  const split = useMemo(
    () => bestSplit(ranked.map((r) => ({ gauge: r.gauge, symbol: gaugeLabel(r), rate: r.feesUsdPerDay + r.incentivesUsdPerDay, weight: r.weight })), amount),
    [ranked, amount],
  );
  if (!(amount > 0)) return <p className="mt-2 text-sm text-amber-500">Enter an amount above zero.</p>;
  if (!split) return <p className={`mt-3 ${NOTE}`}>Nothing to rank yet.</p>;

  const gain = split.bestSingleUsdPerDay > 0 ? (split.usdPerDay / split.bestSingleUsdPerDay - 1) * 100 : 0;
  const byGauge = new Map(ranked.map((r) => [r.gauge.toLowerCase(), r]));
  const weakest = split.parts.reduce((h, p) => Math.min(h, byGauge.get(p.gauge.toLowerCase())?.windowHours ?? 0), Infinity);
  const conf = paceConfidence(weakest);

  return (
    <div className="mt-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Card value={`$${usd2(split.usdPerDay)}`} label={`per day, best split of your amount${apr(split.usdPerDay) !== null ? ` · about ${fmtApr(apr(split.usdPerDay)!)} APR` : ""}`} tone="good" />
        <Card
          value={gain >= 0.5 ? `+${gain.toFixed(1)}%` : "same"}
          label={gain >= 0.5 ? "more than putting it all in the top gauge" : "as putting it all in the top gauge"}
        />
        <Card value={`$${usd2((split.usdPerDay * LOCK_HOURS) / 24)}`} label={`over the ${LOCK_HOURS} h lock before you can move it`} />
        <Card value={conf} label={`how steady the fee pace is (${Math.round(weakest)} h of history in the weakest pick)`} />
      </div>
      <p className="mt-3 text-sm text-neutral-300">
        Best split:{" "}
        {split.parts.map((p, i) => (
          <span key={p.gauge}>
            {i > 0 && " · "}
            <span className="text-neutral-200">{p.symbol}</span> {p.pct}%
          </span>
        ))}
      </p>
    </div>
  );
}
