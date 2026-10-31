"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { TrackSummary } from "@/lib/track-record";
import { LINK, NOTE, NUM } from "./ui";

const usd = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const date = (day: number) => new Date(day * 86_400_000).toISOString().slice(0, 10);

/**
 * The site marking its own homework. Every day it writes down the best split for 10,000 sAERO on Base, before knowing what the gauges
 * will pay, and checks it two days later against what they did pay. Nothing is shown as a result until 14 days are checked; before that
 * the panel says how far along it is, so an early lucky week can't pass for a record.
 */
export function TrackRecordPanel({ standalone = false }: { standalone?: boolean } = {}) {
  const [data, setData] = useState<TrackSummary | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    fetch("/api/track-record")
      .then((r) => (r.ok ? (r.json() as Promise<TrackSummary>) : Promise.reject(new Error(String(r.status)))))
      .then((d) => live && setData(d))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, []);
  // On the home page the panel simply stays away until it has data; on its own page an empty screen would look broken.
  if (!data) return standalone ? <p className={`mt-4 ${NOTE}`}>{failed ? "Couldn’t load the track record. Try again in a minute." : "Loading the track record…"}</p> : null;
  const r = data.results;
  return (
    <section id="track" className="mt-4 scroll-mt-36 rounded-xl border border-neutral-800 bg-neutral-900/40 px-3 py-4 sm:px-5">
      {standalone ? (
        <h1 className="text-xl font-semibold tracking-tight text-white sm:text-2xl">Does the advice hold up?</h1>
      ) : (
        <h2 className="text-base font-semibold text-neutral-100">
          Does the advice hold up?{" "}
          <Link href="/track-record" className={`text-sm font-normal ${LINK}`}>
            own page
          </Link>
        </h2>
      )}
      <p className={`mt-2 ${NOTE}`}>
        Every day this site writes down the best split it would give for {data.amount.toLocaleString("en-US")} sAERO on Base, before it knows what the gauges will pay. Two days later it checks that
        split against what those gauges really paid.
      </p>
      {!r ? (
        <p className="mt-2 text-sm text-neutral-300">
          Results appear after {data.needed} checked days, so a lucky week can&rsquo;t pass for a record. So far: {data.logged} logged, {data.evaluated} checked.
        </p>
      ) : (
        <>
          <p className="mt-2 text-sm text-neutral-300">
            Over {data.evaluated} checked days, the split paid a median{" "}
            <span className={`text-neutral-100 ${NUM}`}>{Math.round(r.medianRealizedOfPredicted * 100)}%</span> of the figure predicted at the time (on average ${usd(r.avgPredictedUsd)} predicted,{" "}
            <span className={`text-neutral-100 ${NUM}`}>${usd(r.avgRealizedUsd)}</span> actual, a day). It paid at least the low case on {r.atLeastLow} of {data.evaluated} days.
          </p>
          <details className="mt-3 rounded-lg border border-neutral-800 px-3 py-2">
            <summary className="cursor-pointer select-none text-sm text-neutral-300">Day by day</summary>
            <ul className="mt-2 divide-y divide-neutral-800/80 text-sm">
              {data.rows.map((row) => (
                <li key={row.day} className="py-2">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-neutral-200">{date(row.day)}</span>
                    <span className={`shrink-0 text-right ${NUM}`}>
                      <span className="text-neutral-400">${usd(row.paceUsd)} predicted</span> ·{" "}
                      <span className={row.realizedUsd === null ? "text-neutral-500" : "text-neutral-100"}>{row.realizedUsd === null ? "not checked yet" : `$${usd(row.realizedUsd)} actual`}</span>
                    </span>
                  </div>
                  <div className={`mt-0.5 break-words ${NOTE}`}>{row.parts.map((p) => `${p.s} ${p.pct}%`).join(" · ")}</div>
                </li>
              ))}
            </ul>
          </details>
        </>
      )}
      <p className={`mt-2 ${NOTE}`}>
        &ldquo;Actual&rdquo; takes the fees and incentives each gauge really paid on the day of the entry and the next, and gives your amount the share of the gauge it would have had at the end of that
        day. It is a check on the estimate, not a promise about the future.
      </p>
    </section>
  );
}
