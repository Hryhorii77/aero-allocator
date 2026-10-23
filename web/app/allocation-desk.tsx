"use client";

import { useMemo } from "react";
import type { GaugeRow } from "@/lib/gauges";
import type { GaugeFees } from "@/lib/gauge-fees-read";
import { MIN_RANK_WEIGHT, paceConfidence, rankByUsdPerDay } from "@/lib/gauge-yield";
import { bestSplit } from "@/lib/split";

const LOCK_HOURS = 47;
const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 0 });
const usd2 = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const TAG: Record<ReturnType<typeof paceConfidence>, string> = {
  thin: "text-amber-500",
  fair: "text-neutral-400",
  solid: "text-emerald-400",
};

function Card({ value, label, tone }: { value: string; label: string; tone?: "good" }) {
  return (
    <div className="min-w-0 rounded-md border border-neutral-800 px-2 py-2">
      <div className={`font-mono text-base ${tone === "good" ? "text-emerald-400" : "text-neutral-100"}`}>{value}</div>
      <div className="mt-0.5 text-[11px] leading-snug text-neutral-500">{label}</div>
    </div>
  );
}

/**
 * What an amount of sAERO earns per day on one chain: the best way to split it across gauges (each gauge you join dilutes
 * the next, so the best answer is usually several), how that compares with going all-in on the top gauge, what it adds up
 * to over the 47-hour lock, and how much history each estimate rests on.
 */
export function AllocationDesk({ gauges, fees, amount }: { gauges: GaugeRow[]; fees: GaugeFees; amount: number }) {
  const ranked = useMemo(() => rankByUsdPerDay(gauges, fees.fees, amount), [gauges, fees, amount]);
  const split = useMemo(
    () => bestSplit(ranked.map((r) => ({ gauge: r.gauge, symbol: r.symbol, rate: r.feesUsdPerDay + r.incentivesUsdPerDay, weight: r.weight })), amount),
    [ranked, amount],
  );
  if (!(amount > 0)) return <p className="mt-2 text-xs text-amber-500">Enter an amount above zero.</p>;
  if (!split) return <p className="mt-2 text-xs text-neutral-500">Nothing to rank yet.</p>;

  const gain = split.bestSingleUsdPerDay > 0 ? (split.usdPerDay / split.bestSingleUsdPerDay - 1) * 100 : 0;
  const byGauge = new Map(ranked.map((r) => [r.gauge.toLowerCase(), r]));
  const weakest = split.parts.reduce((h, p) => Math.min(h, byGauge.get(p.gauge.toLowerCase())?.windowHours ?? 0), Infinity);
  const conf = paceConfidence(weakest);
  const top = ranked.slice(0, 8);

  return (
    <div className="mt-2">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Card value={`$${usd2(split.usdPerDay)}`} label="per day, best split of your amount" tone="good" />
        <Card
          value={gain >= 0.5 ? `+${gain.toFixed(1)}%` : "same"}
          label={gain >= 0.5 ? "more than putting it all in the top gauge" : "as putting it all in the top gauge"}
        />
        <Card value={`$${usd2((split.usdPerDay * LOCK_HOURS) / 24)}`} label={`over the ${LOCK_HOURS} h lock before you can move it`} />
        <Card value={conf} label={`how steady the fee pace is (${Math.round(weakest)} h of history in the weakest pick)`} />
      </div>
      <p className="mt-2 text-xs text-neutral-400">
        Best split:{" "}
        {split.parts.map((p, i) => (
          <span key={p.gauge}>
            {i > 0 && " · "}
            <span className="text-neutral-200">{p.symbol}</span> {p.pct}%
          </span>
        ))}
      </p>
      <div className="mt-2 space-y-0.5 font-mono text-[11px] text-neutral-500">
        {top.map((r) => (
          <div key={r.gauge} className="flex flex-wrap gap-x-3">
            <span className="w-32 shrink-0 truncate text-neutral-300">{r.symbol}</span>
            <span>
              <span className="text-emerald-400">${usd2(r.usdPerDay)}</span>/day all-in
            </span>
            <span>
              fees ${fmt(r.feesUsdPerDay)} + incentives ${fmt(r.incentivesUsdPerDay)} per day across all voters
            </span>
            <span>{fmt(r.weight)} power in it</span>
            <span className={TAG[paceConfidence(r.windowHours)]}>{paceConfidence(r.windowHours)} pace</span>
          </div>
        ))}
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-neutral-500">
        Fees are the pace of the last ~{Math.round(fees.windowHours)} hours, not a promise: a quiet or busy stretch moves them a lot, so
        &ldquo;thin&rdquo; (under 6 h of history) is a rough guide. Your own allocation shares each gauge, and every gauge you add dilutes
        the next, so the split already counts that. Only gauges with a fee estimate and at least {fmt(MIN_RANK_WEIGHT)} power are ranked (
        {fees.fees.length} of {gauges.length} gauges have a measurable pace).
      </p>
    </div>
  );
}
