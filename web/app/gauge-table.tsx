"use client";

import { useEffect, useState } from "react";
import { DISPLAY_PRESET } from "@/lib/protocol";
import type { GaugeList } from "@/lib/gauges";
import type { GaugeFees } from "@/lib/gauge-fees-read";
import { MIN_RANK_WEIGHT, rankByUsdPerDay } from "@/lib/gauge-yield";
import { AERO_LAUNCH_AT_MS } from "./launch";
import { btn } from "./ui";

const SHOWN = 12;
const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 0 });
const usd2 = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Aero gauges on Base after launch: where allocation weight sits now and each gauge's emission cap. Read-only; no fees or bribes yet. */
export function GaugeTable() {
  const [live, setLive] = useState(false);
  const [data, setData] = useState<GaugeList | null>(null);
  const [failed, setFailed] = useState(false);
  const [all, setAll] = useState(false);
  const [fees, setFees] = useState<GaugeFees | null>(null);
  const [feesFailed, setFeesFailed] = useState(false);
  const [amountText, setAmountText] = useState("10000");

  useEffect(() => {
    const isLive = DISPLAY_PRESET.protocol === "aerodrome" && Date.now() >= AERO_LAUNCH_AT_MS;
    setLive(isLive);
    if (!isLive) return;
    let cancelled = false;
    fetch("/api/gauges")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: GaugeList) => !cancelled && setData(d))
      .catch(() => !cancelled && setFailed(true));
    // Fee estimates read event logs and take several seconds the first time, so they load after the list.
    fetch("/api/gauge-fees")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: GaugeFees) => !cancelled && setFees(d))
      .catch(() => !cancelled && setFeesFailed(true));
    return () => {
      cancelled = true;
    };
  }, []);

  if (!live) return null;
  const rows = data ? (all ? data.gauges : data.gauges.slice(0, SHOWN)) : [];
  const amount = Number(amountText.replace(/,/g, ""));
  const ranked = data && fees ? rankByUsdPerDay(data.gauges, fees.fees, amount).slice(0, 8) : [];
  return (
    <details open className="mt-3 rounded-lg border border-neutral-800 bg-neutral-900/40 px-3 py-2">
      <summary className="cursor-pointer select-none text-sm font-medium text-neutral-200">
        Aero gauges on Base{data ? ` (${data.gauges.length})` : ""}
      </summary>
      <p className="mt-2 text-xs text-neutral-500">
        Share of the allocation weight now sitting on each gauge, and its emission cap in AERO per week. Incentives streaming now are shown where a gauge has
        any; trading fees per gauge are not included yet, so this is not a full return figure.
      </p>
      <div className="mt-3 rounded-md border border-neutral-800 px-2 py-2">
        <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-400">
          <span>What</span>
          <input
            type="text"
            inputMode="numeric"
            value={amountText}
            onChange={(e) => setAmountText(e.target.value)}
            aria-label="sAERO amount"
            className="w-24 rounded-lg border border-neutral-700 bg-neutral-950 px-2 py-1 font-mono text-xs text-neutral-200 focus:border-sky-600 focus:outline-none"
          />
          <span>sAERO earns per day, by gauge:</span>
        </div>
        {!fees && !feesFailed && <p className="mt-2 text-xs text-neutral-500">Reading fees from recent blocks…</p>}
        {feesFailed && <p className="mt-2 text-xs text-amber-500">Fee estimates are unavailable right now.</p>}
        {fees && ranked.length === 0 && amount > 0 && <p className="mt-2 text-xs text-neutral-500">Nothing to rank yet.</p>}
        {fees && !(amount > 0) && <p className="mt-2 text-xs text-amber-500">Enter an amount above zero.</p>}
        {ranked.length > 0 && (
          <div className="mt-2 space-y-0.5 font-mono text-[11px] text-neutral-500">
            {ranked.map((r) => (
              <div key={r.gauge} className="flex flex-wrap gap-x-3">
                <span className="w-32 shrink-0 truncate text-neutral-300">{r.symbol}</span>
                <span>
                  <span className="text-emerald-400">${usd2(r.usdPerDay)}</span>/day
                </span>
                <span>
                  fees ${fmt(r.feesUsdPerDay)} + incentives ${fmt(r.incentivesUsdPerDay)} per day across all voters
                </span>
                <span>you would hold {r.sharePct.toFixed(2)}%</span>
              </div>
            ))}
          </div>
        )}
        {fees && (
          <p className="mt-2 text-[11px] leading-relaxed text-neutral-500">
            Fees are the pace of the last ~{Math.round(fees.windowHours)} hours, not a promise: a quiet or busy stretch moves
            them a lot. Your own allocation shares the gauge, so the figure already counts that. Only gauges with a fee
            estimate and at least {fmt(MIN_RANK_WEIGHT)} power are ranked ({fees.fees.length} gauges checked: the heaviest plus the
            busiest by recent fees).
          </p>
        )}
      </div>
      {failed && <p className="mt-2 text-xs text-rose-400">Couldn&rsquo;t load gauges. Try again in a moment.</p>}
      {!data && !failed && <p className="mt-2 text-xs text-neutral-500">Loading gauges…</p>}
      {data && (
        <>
          <div className="mt-2 space-y-0.5 font-mono text-[11px] text-neutral-500">
            {rows.map((g) => (
              <div key={g.gauge} className="flex flex-wrap gap-x-3">
                <span className="w-32 shrink-0 truncate text-neutral-300">{g.symbol}</span>
                <span>
                  <span className="text-neutral-300">{g.sharePct.toFixed(2)}%</span> of weight
                </span>
                <span>
                  cap <span className="text-neutral-300">{fmt(g.capPerWeek)}</span> AERO/wk
                </span>
                {g.incentivesUsdPerWeek > 0 && (
                  <span>
                    incentives <span className="text-neutral-300">${fmt(g.incentivesUsdPerWeek)}</span>/wk ·{" "}
                    <span className="text-neutral-300">${g.incentivesUsdPer1k.toFixed(2)}</span> per 1k
                  </span>
                )}
                {!g.activated && <span className="text-amber-500">not activated</span>}
              </div>
            ))}
          </div>
          {data.gauges.length > SHOWN && (
            <button type="button" className={`mt-2 ${btn("secondary", "sm")}`} onClick={() => setAll((v) => !v)}>
              {all ? "show top 12" : `show all ${data.gauges.length}`}
            </button>
          )}
        </>
      )}
    </details>
  );
}
