"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { TrackSummary } from "@/lib/track-record";
import { LINK, NOTE, NUM, TAG } from "./ui";
import { fetchJson } from "@/lib/fetch-json";

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
    fetchJson<TrackSummary>("/api/track-record")
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
        <p className="mt-2 text-sm text-neutral-300">
          Over {data.evaluated} checked days, the split paid a median{" "}
          <span className={`text-neutral-100 ${NUM}`}>{Math.round(r.medianRealizedOfPredicted * 100)}%</span> of the figure predicted at the time (on average ${usd(r.avgPredictedUsd)} predicted,{" "}
          <span className={`text-neutral-100 ${NUM}`}>${usd(r.avgRealizedUsd)}</span> actual, a day). It paid at least the low case on {r.atLeastLow} of {data.evaluated} days.
        </p>
      )}
      {data.vsAutopilot && (
        <p className="mt-2 text-sm text-neutral-300">
          Against Aero&rsquo;s Autopilot: over {data.vsAutopilot.days} days with both checked, the split paid{" "}
          <span className={`text-neutral-100 ${NUM}`}>${usd(data.vsAutopilot.avgSplitUsd)}</span> a day on average and the same amount in Autopilot&rsquo;s largest pool{" "}
          <span className={`text-neutral-100 ${NUM}`}>${usd(data.vsAutopilot.avgAutopilotUsd)}</span>, before its own fee. The split was ahead on {data.vsAutopilot.splitAhead} of{" "}
          {data.vsAutopilot.days} days.
        </p>
      )}
      {/* The days themselves are shown before the 14-day summary only on the page of their own: each is a dated prediction, so listing them early proves
          nothing either way but shows the record is being kept. The home panel waits for results, and keeps the list folded. */}
      {data.rows.length > 0 && (r || standalone) && (
        <details open={standalone} className="mt-3 rounded-lg border border-neutral-800 px-3 py-2">
          <summary className="cursor-pointer select-none text-sm text-neutral-300">Day by day</summary>
          <ul className="mt-2 divide-y divide-neutral-800/80 text-sm">
            {data.rows.map((row) => (
              <li key={row.day} className="py-2">
                {/* Date above the figures on a phone: side by side they overflowed a 360px screen by 70px. */}
                <div className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3">
                  <span className="whitespace-nowrap text-neutral-200">
                    {date(row.day)}
                    {row.rule !== data.rule && <span className={`ml-2 ${TAG} text-neutral-400`} title="Chosen under an earlier ranking rule: shown, not counted in the results">earlier rule</span>}
                  </span>
                  <span className={`sm:shrink-0 sm:text-right ${NUM}`}>
                    <span className="text-neutral-400">${usd(row.paceUsd)} predicted</span> ·{" "}
                    <span className={row.realizedUsd === null ? "text-neutral-500" : "text-neutral-100"}>{row.realizedUsd === null ? "not checked yet" : `$${usd(row.realizedUsd)} actual`}</span>
                  </span>
                </div>
                <div className={`mt-0.5 break-words ${NOTE}`}>{row.parts.map((p) => `${p.s} ${p.pct}%`).join(" · ")}</div>
                {row.autopilot && (
                  <div className={`mt-0.5 ${NOTE}`}>
                    Autopilot, same amount:{" "}
                    {row.autopilot.map((a, i) => (
                      <span key={a.id} className={NUM}>
                        {i > 0 && " · "}
                        {a.realizedUsd === null ? "not checked yet" : `$${usd(a.realizedUsd)}`} (#{a.id})
                      </span>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
      {data.earlierRule > 0 && (
        <p className={`mt-2 ${NOTE}`}>
          Days marked &ldquo;earlier rule&rdquo; were chosen before 2026-11-04, when the split still ranked a pool by a burst of fees (the two checked
          ones paid far less than predicted). Since then a pool whose fees are a burst is ranked at its usual level. Those days stay listed but
          don&rsquo;t count toward the results.
        </p>
      )}
      <p className={`mt-2 ${NOTE}`}>
        &ldquo;Actual&rdquo; takes the fees and incentives each gauge really paid on the day of the entry and the next, and gives your amount the share of the gauge it would have had at the end of that
        day. It is a check on the estimate, not a promise about the future.
      </p>
      {data.rows.some((row) => row.autopilot) && (
        <p className={`mt-2 ${NOTE}`}>
          &ldquo;Autopilot, same amount&rdquo; spreads the amount the way each Autopilot pool had its power that morning (the share it kept idle earns nothing) and prices it from what those gauges
          paid on every chain over the same two days. It assumes the pool didn&rsquo;t move in between and is before Autopilot&rsquo;s own fee, which Aero hasn&rsquo;t published.
        </p>
      )}
    </section>
  );
}
