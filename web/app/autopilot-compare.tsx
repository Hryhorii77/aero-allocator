"use client";

import { useEffect, useMemo, useState } from "react";
import { chainShares, depositUsdPerDay, type AutopilotData } from "@/lib/autopilot";
import type { GaugeFees } from "@/lib/gauge-fees-read";
import { rankByUsdPerDay } from "@/lib/gauge-yield";
import type { GaugeRow } from "@/lib/gauges";
import { fetchJson } from "@/lib/fetch-json";
import { DEFAULT_COOLDOWN_SEC, waitHours } from "@/lib/saero";
import { bestSplit, splitRate } from "@/lib/split";
import { btn, NOTE, NUM } from "./ui";

const usd2 = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const big = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : `${Math.round(n / 1e3)}k`);
const pct = (n: number) => (n >= 10 ? Math.round(n).toString() : n.toFixed(1));

/**
 * What Aero's Autopilot would pay the viewer's amount next to the site's best split, from Autopilot's own pools on-chain (found by their
 * owner's factory, read on every chain). A deposit earns the pool's rate, power it holds idle included, before a fee Aero hasn't published;
 * the best split takes better marginal rates for an amount this size. Autopilot's case is that it manages the waits and claims for you.
 */
export function AutopilotComparePanel({ gauges, fees, amount, cooldownSec }: { gauges: GaugeRow[]; fees: GaugeFees; amount: number; cooldownSec?: number }) {
  const [open, setOpen] = useState(false);
  const [got, setGot] = useState<AutopilotData | "failed" | null>(null);

  useEffect(() => {
    if (!open || got) return;
    let live = true;
    fetchJson<AutopilotData>("/api/autopilot")
      .then((d) => live && setGot(Array.isArray(d.pools) ? d : "failed"))
      .catch(() => live && setGot("failed"));
    return () => {
      live = false;
    };
  }, [open, got]);

  const best = useMemo(() => {
    const ranked = rankByUsdPerDay(gauges, fees.fees, amount, undefined, { waitSec: cooldownSec });
    return bestSplit(ranked.map((r) => ({ gauge: r.gauge, symbol: r.symbol, rate: splitRate(r), weight: r.weight })), amount)?.usdPerDay ?? null;
  }, [gauges, fees, amount, cooldownSec]);
  const hours = waitHours(cooldownSec ?? DEFAULT_COOLDOWN_SEC);

  if (!open) {
    return (
      <div className="mt-4">
        <button type="button" className={btn("secondary", "sm")} onClick={() => setOpen(true)}>
          compare with Autopilot
        </button>
        <span className={`ml-2 ${NOTE}`}>What Aero&rsquo;s Autopilot would pay your amount, from its own pools on-chain.</span>
      </div>
    );
  }
  const data = got && got !== "failed" ? got : null;
  return (
    <div className="mt-4 rounded-lg border border-neutral-800 px-3 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-neutral-100">Autopilot vs the best split</span>
        <button type="button" className={`ml-auto ${btn("secondary", "sm")}`} onClick={() => setOpen(false)}>
          close
        </button>
      </div>
      {got === "failed" && <p className="mt-2 text-sm text-rose-400">Could not read Autopilot&rsquo;s pools just now. Try again in a moment.</p>}
      {!got && <p className={`mt-2 ${NOTE}`}>Reading Autopilot&rsquo;s pools on every chain (up to half a minute the first time)…</p>}
      {data && data.pools.length === 0 && <p className={`mt-2 ${NOTE}`}>No Autopilot pool holds any power right now.</p>}
      {data && data.pools.length > 0 && (
        <>
          <ul className="mt-2 divide-y divide-neutral-800/80">
            {data.pools.map((p) => {
              const you = depositUsdPerDay(p, amount);
              const share = chainShares(p);
              return (
                <li key={p.tokenId} className="py-2.5">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <span className="text-sm text-neutral-100">
                      Autopilot pool #{p.tokenId} <span className={`text-neutral-400 ${NUM}`}>· {big(p.power)} power</span>
                    </span>
                    <span className={`text-sm ${NUM}`}>
                      for you <span className="text-emerald-400">${usd2(you)}</span>
                      <span className="text-neutral-500">/day{best !== null ? ` · best split $${usd2(best)}` : ""}</span>
                    </span>
                  </div>
                  <p className={`mt-0.5 ${NOTE}`}>
                    {share.chains.map((c) => `${c.name} ${pct(c.pct)}%`).join(" · ")}
                    {share.idlePct >= 0.5 ? ` · not on any gauge ${pct(share.idlePct)}%` : ""}
                  </p>
                </li>
              );
            })}
          </ul>
          <p className={`mt-2 ${NOTE}`}>
            A deposit earns its pool&rsquo;s rate, worked out here from where the pool&rsquo;s power sits now and priced like the best split (a burst of fees at the
            gauge&rsquo;s usual level). Power the pool holds off every gauge, new deposits waiting their turn or power in transit, earns nothing and lowers that rate
            for everyone in it. The figure is before Autopilot&rsquo;s own fee, which Aero hasn&rsquo;t published, and a new deposit waits in a queue of up to {hours} hours
            before it earns anything.
          </p>
          <p className={`mt-1 ${NOTE}`}>
            The best split usually pays an amount this size more, because it doesn&rsquo;t dilute the gauges it joins the way a pool of millions does. Autopilot&rsquo;s
            case is convenience: its keeper re-allocates after each wait and claims the revenue for you (one pool compounds it into AERO, the other converts it to one
            token; which is which isn&rsquo;t readable on-chain). Read {new Date(data.generatedAt).toISOString().slice(11, 16)} UTC, refreshed every 30 minutes.
            {data.skipped.length > 0 ? ` Not read just now: ${data.skipped.join(", ")}; those parts count as earning nothing.` : ""}
          </p>
        </>
      )}
    </div>
  );
}
