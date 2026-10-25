"use client";

import { useEffect, useState } from "react";
import type { GaugeHistory } from "@/lib/gauge-fees-read";
import { formatFlow } from "@/lib/weight-history";
import { NOTE, NUM } from "./ui";

const W = 320;
const H = 84;
const usd = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 0 });
const day = (t: number) => new Date(t * 1000).toLocaleString("en-US", { weekday: "short", hour: "2-digit", hour12: false, timeZone: "UTC" });

/** Fees released per 6 hours as bars and, once the snapshots exist, the gauge's power as a line, for one gauge. */
export function GaugeHistoryPanel({ chainId, gauge }: { chainId: number; gauge: string }) {
  const [data, setData] = useState<GaugeHistory | null>(null);
  const [state, setState] = useState<"loading" | "done" | "error">("loading");

  useEffect(() => {
    let cancelled = false;
    setState("loading");
    fetch(`/api/gauge-history?chain=${chainId}&gauge=${gauge}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: GaugeHistory) => {
        if (cancelled) return;
        setData(d);
        setState("done");
      })
      .catch(() => !cancelled && setState("error"));
    return () => {
      cancelled = true;
    };
  }, [chainId, gauge]);

  if (state === "loading") return <p className={NOTE}>Loading history…</p>;
  if (state === "error" || !data) return <p className="text-sm text-rose-400">Couldn&rsquo;t load this gauge&rsquo;s history. Try again in a moment.</p>;

  const { fees, weights, steady, flow } = data;
  if (fees.length === 0 && weights.length < 2) {
    return <p className={NOTE}>Not enough history yet: it needs a few releases after the first one the record saw, or a couple of weight snapshots.</p>;
  }
  const max = Math.max(1, ...fees.map((b) => b.usd));
  const bw = fees.length > 0 ? W / fees.length : W;
  const wMin = Math.min(...weights.map((p) => p.weight));
  const wMax = Math.max(...weights.map((p) => p.weight));
  const t0 = Math.min(fees[0]?.t ?? Infinity, weights[0]?.t ?? Infinity);
  const t1 = Math.max(fees.length ? fees[fees.length - 1].t + 6 * 3600 : 0, weights[weights.length - 1]?.t ?? 0);
  const x = (t: number) => ((t - t0) / Math.max(1, t1 - t0)) * W;
  const line = weights.length >= 2 ? weights.map((p) => `${x(p.t).toFixed(1)},${(H - 4 - ((p.weight - wMin) / Math.max(1, wMax - wMin)) * (H - 12)).toFixed(1)}`).join(" ") : "";
  const label = `Fees released per 6 hours, from $${usd(Math.min(...fees.map((b) => b.usd), 0))} to $${usd(max)}${line ? "; power in the gauge as a line" : ""}`;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-2 sm:grid-cols-[minmax(0,320px)_minmax(0,1fr)] sm:gap-4">
      <div>
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={label}>
          {fees.map((b, i) => {
            const h = (b.usd / max) * (H - 8);
            return <rect key={b.t} x={fees.length ? i * bw + 1 : 0} y={H - 4 - h} width={Math.max(1, bw - 2)} height={Math.max(h, b.usd > 0 ? 1 : 0)} className="fill-sky-500/60" />;
          })}
          {line && <polyline points={line} fill="none" className="stroke-neutral-400" strokeWidth="1.5" />}
        </svg>
        <div className="flex justify-between text-xs text-neutral-500">
          <span>{Number.isFinite(t0) ? `${day(t0)} UTC` : ""}</span>
          <span>now</span>
        </div>
      </div>
      <div className="text-sm leading-relaxed text-neutral-400">
        {steady ? (
          <p>
            Paid at least half its average in <span className={`text-neutral-200 ${NUM}`}>{steady.paying} of {steady.buckets}</span> half-days.
          </p>
        ) : (
          <p>Steadiness needs three complete half-days of releases.</p>
        )}
        {flow && (
          <p>
            Its share of the weight moved <span className={`text-neutral-200 ${NUM}`}>{formatFlow(flow.sharePctChange)}</span> over the snapshot window.
          </p>
        )}
        <p className={NOTE}>
          Bars are fees released per 6 hours at today&rsquo;s prices{line ? "; the line is the power in the gauge" : "; the power line appears once weight snapshots build up"}. Fees are released in
          lumps, so one empty bar means no release then, not no trading.
        </p>
      </div>
    </div>
  );
}
