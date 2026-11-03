"use client";

import { useEffect, useMemo, useState } from "react";
import type { GaugeFees } from "@/lib/gauge-fees-read";
import { rankByUsdPerDay } from "@/lib/gauge-yield";
import { gaugeLabel, type GaugeRow } from "@/lib/gauges";
import { setPresetSplit } from "@/lib/preset-split";
import { bestSplit, splitRate } from "@/lib/split";
import { priceCopy, type TopAllocators } from "@/lib/top-allocators";
import { btn, NOTE, NUM, TAG } from "./ui";
import { fetchJson } from "@/lib/fetch-json";

const usd2 = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const big = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(Math.round(n)));
const SHOWN_PARTS = 3;

/**
 * The largest positions and how they split their Base power, each priced for the viewer's own amount next to the best split. A big
 * position spreads out so it doesn't dilute itself; a small one usually earns more concentrated, which is why the comparison is shown
 * before the copy button. "Use this split" only fills the allocate panel below; nothing is sent until the owner signs there.
 */
export function TopAllocatorsPanel({ gauges, fees, amount, cooldownSec }: { gauges: GaugeRow[]; fees: GaugeFees; amount: number; cooldownSec?: number }) {
  const [open, setOpen] = useState(false);
  const [got, setGot] = useState<TopAllocators | "failed" | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    if (!open || got) return;
    let live = true;
    fetchJson<TopAllocators>("/api/top-allocators")
      .then((d) => live && setGot(Array.isArray(d.allocators) ? d : "failed"))
      .catch(() => live && setGot("failed"));
    return () => {
      live = false;
    };
  }, [open, got]);

  // Priced against every gauge with a fee estimate (no weight minimum): a big allocator can sit on a thin gauge the table doesn't rank.
  const rows = useMemo(() => rankByUsdPerDay(gauges, fees.fees, amount, 0, { waitSec: cooldownSec }), [gauges, fees, amount, cooldownSec]);
  // The best split for the same amount, priced the same way, to compare each copy against.
  const bestUsdPerDay = useMemo(() => {
    const ranked = rankByUsdPerDay(gauges, fees.fees, amount, undefined, { waitSec: cooldownSec });
    return bestSplit(ranked.map((r) => ({ gauge: r.gauge, symbol: r.symbol, rate: splitRate(r), weight: r.weight })), amount)?.usdPerDay ?? null;
  }, [gauges, fees, amount, cooldownSec]);
  const labelOf = useMemo(() => {
    const m = new Map(gauges.map((g) => [g.gauge.toLowerCase(), gaugeLabel(g)]));
    return (a: string) => m.get(a.toLowerCase()) ?? `${a.slice(0, 6)}…`;
  }, [gauges]);

  if (!open) {
    return (
      <div className="mt-4">
        <button type="button" className={btn("secondary", "sm")} onClick={() => setOpen(true)}>
          biggest allocators
        </button>
        <span className={`ml-2 ${NOTE}`}>How the largest positions split Base, and what their split would earn you.</span>
      </div>
    );
  }
  const data = got && got !== "failed" ? got : null;
  return (
    <div className="mt-4 rounded-lg border border-neutral-800 px-3 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-neutral-100">The biggest allocators on Base</span>
        <button type="button" className={`ml-auto ${btn("secondary", "sm")}`} onClick={() => setOpen(false)}>
          close
        </button>
      </div>
      {got === "failed" && <p className="mt-2 text-sm text-rose-400">Could not read the positions just now. Try again in a moment.</p>}
      {!got && <p className={`mt-2 ${NOTE}`}>Reading every position&rsquo;s power from Base (a few seconds the first time)…</p>}
      {data && (
        <>
          <p className={`mt-2 ${NOTE}`}>
            The {data.allocators.length} largest of all positions by voting power, by position id. A big position spreads out so it doesn&rsquo;t dilute itself, which
            rarely suits a smaller amount: &ldquo;for you&rdquo; prices each split for your {amount.toLocaleString("en-US")} sAERO the same way the best split is priced.
          </p>
          <ul className="mt-2 divide-y divide-neutral-800/80">
            {data.allocators.map((a) => {
              const priced = a.parts.length > 0 ? priceCopy(a.parts, rows, amount) : null;
              const share = data.totalPower > 0 ? (a.power / data.totalPower) * 100 : 0;
              const onBasePct = a.power > 0 ? Math.min(100, (a.onBase / a.power) * 100) : 0;
              return (
                <li key={a.tokenId} className="py-2.5">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <span className="text-sm text-neutral-100">
                      #{a.tokenId}
                      {a.autopilot && <span className={`ml-1.5 ${TAG} text-sky-300`} title="One of Aero Autopilot's pooled positions: many depositors, allocated by Aero's keeper">Aero Autopilot</span>}{" "}
                      <span className={`text-neutral-400 ${NUM}`}>· {big(a.power)} power ({share.toFixed(1)}% of all) · {Math.round(onBasePct)}% on Base</span>
                    </span>
                    {priced && (
                      <span className={`text-sm ${NUM}`}>
                        for you <span className="text-emerald-400">${usd2(priced.usdPerDay)}</span>
                        <span className="text-neutral-500">/day{bestUsdPerDay !== null ? ` · best split $${usd2(bestUsdPerDay)}` : ""}</span>
                      </span>
                    )}
                  </div>
                  {a.parts.length === 0 ? (
                    <p className={`mt-0.5 ${NOTE}`}>Nothing on Base gauges right now.</p>
                  ) : (
                    <>
                      <p className={`mt-0.5 break-words ${NOTE}`}>
                        {a.parts
                          .slice(0, SHOWN_PARTS)
                          .map((p) => `${labelOf(p.gauge)} ${p.pct}%`)
                          .join(" · ")}
                        {a.parts.length > SHOWN_PARTS ? ` · and ${a.parts.length - SHOWN_PARTS} more` : ""}
                        {priced && priced.unpriced > 0 ? ` (${priced.unpriced} with no fee estimate count as $0)` : ""}
                      </p>
                      <div className="mt-1.5 flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          className={btn("secondary", "sm")}
                          onClick={() => {
                            setPresetSplit({ from: `position #${a.tokenId}`, parts: a.parts });
                            setCopied(a.tokenId);
                            document.getElementById("positions")?.scrollIntoView({ behavior: "smooth" });
                          }}
                        >
                          use this split
                        </button>
                        {copied === a.tokenId && <span className={NOTE}>Copied. Open &ldquo;allocate…&rdquo; on your position below: it starts from this split, and you check it before you sign.</span>}
                      </div>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
          <p className={`mt-2 ${NOTE}`}>Read from Base at {new Date(data.generatedAt).toISOString().slice(11, 16)} UTC (refreshed every 30 minutes). Positions are shown by id only.</p>
        </>
      )}
    </div>
  );
}
