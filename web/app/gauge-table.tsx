"use client";

import { useEffect, useState } from "react";
import { DISPLAY_PRESET } from "@/lib/protocol";
import type { GaugeList } from "@/lib/gauges";
import { AERO_LAUNCH_AT_MS } from "./launch";
import { btn } from "./ui";

const SHOWN = 12;
const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 0 });

/** Aero gauges on Base after launch: where allocation weight sits now and each gauge's emission cap. Read-only; no fees or bribes yet. */
export function GaugeTable() {
  const [live, setLive] = useState(false);
  const [data, setData] = useState<GaugeList | null>(null);
  const [failed, setFailed] = useState(false);
  const [all, setAll] = useState(false);

  useEffect(() => {
    const isLive = DISPLAY_PRESET.protocol === "aerodrome" && Date.now() >= AERO_LAUNCH_AT_MS;
    setLive(isLive);
    if (!isLive) return;
    let cancelled = false;
    fetch("/api/gauges")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: GaugeList) => !cancelled && setData(d))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, []);

  if (!live) return null;
  const rows = data ? (all ? data.gauges : data.gauges.slice(0, SHOWN)) : [];
  return (
    <details open className="mt-3 rounded-lg border border-neutral-800 bg-neutral-900/40 px-3 py-2">
      <summary className="cursor-pointer select-none text-sm font-medium text-neutral-200">
        Aero gauges on Base{data ? ` (${data.gauges.length})` : ""}
      </summary>
      <p className="mt-2 text-xs text-neutral-500">
        Share of the allocation weight now sitting on each gauge, and its emission cap in AERO per week. Incentives streaming now are shown where a gauge has
        any; trading fees per gauge are not included yet, so this is not a full return figure.
      </p>
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
