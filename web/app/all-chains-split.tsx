"use client";

import { useEffect, useState } from "react";
import type { AllChainsSplit } from "@/lib/all-chains-read";
import { ago } from "@/lib/ago";
import { btn, chip, NOTE, NUM } from "./ui";

const usd = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const HORIZONS: Array<{ label: string; days?: number }> = [{ label: "the wait" }, { label: "7 days", days: 7 }, { label: "30 days", days: 30 }];

/** "47 hours" for a short horizon, "7 days" for a longer one. */
export const horizonText = (days: number) => (days < 2.5 ? `${Math.round(days * 24)} hours` : `${Math.round(days)} days`);

/**
 * Shown while the read runs. One request can't report its own progress, so this counts the seconds honestly and says why it takes
 * a while: seven chains are read one after another when nothing is cached (up to about 20 s), and a repeat is quick.
 */
export function ReadingNote() {
  const [sec, setSec] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setSec((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="mt-2" role="status">
      <p className={NOTE}>
        Reading every chain… {sec} s. The first read can take up to about 20 seconds because seven chains are read live; repeat reads are quick.
      </p>
      <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-neutral-800" aria-hidden>
        <div className="h-full w-1/3 animate-pulse rounded-full bg-sky-500" />
      </div>
    </div>
  );
}

/**
 * The table above is one chain at a time. This tries every set of chains for the amount and shows the one that earns the most after
 * the one-off ETH each extra chain costs to reach, next to Base alone. It reads only public data and sends nothing.
 */
export function AllChainsSplitPanel({ amount }: { amount: number }) {
  const [open, setOpen] = useState(false);
  const [horizon, setHorizon] = useState(0);
  const [got, setGot] = useState<{ key: string; data: AllChainsSplit } | "failed" | null>(null);
  const days = HORIZONS[horizon].days;
  const key = `${amount}:${days ?? "wait"}`;

  // Typing an amount changes it on every keystroke, so the read waits for a short pause.
  useEffect(() => {
    if (!open) return;
    let live = true;
    const t = setTimeout(() => {
      fetch(`/api/all-chains-split?amount=${amount}${days ? `&days=${days}` : ""}`)
        .then((r) => (r.ok ? (r.json() as Promise<AllChainsSplit>) : Promise.reject(new Error(String(r.status)))))
        .then((data) => live && setGot({ key, data }))
        .catch(() => live && setGot("failed"));
    }, 600);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [open, key, amount, days]);

  if (!open) {
    return (
      <div className="mt-4">
        <button type="button" className={btn("secondary", "sm")} onClick={() => setOpen(true)}>
          compare all chains
        </button>
        <span className={`ml-2 ${NOTE}`}>The table is one chain at a time. This finds the best split over every chain at once.</span>
      </div>
    );
  }
  const res = got && got !== "failed" && got.key === key ? got.data : null;
  const best = res?.best;
  const only = res?.baseOnly;
  const stays = best && best.chains.length === 1 && best.chains[0].chainId === 8453;
  const extra = best && only ? best.netUsd - only.netUsd : 0;
  return (
    <div className="mt-4 rounded-lg border border-neutral-800 px-3 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-neutral-100">Best split over all chains</span>
        <span className={NOTE}>fees weighed over</span>
        {HORIZONS.map((h, i) => (
          <button key={h.label} type="button" className={chip(i === horizon)} aria-pressed={i === horizon} onClick={() => setHorizon(i)}>
            {h.label}
          </button>
        ))}
        <button type="button" className={`ml-auto ${btn("secondary", "sm")}`} onClick={() => setOpen(false)}>
          close
        </button>
      </div>
      {got === "failed" && <p className="mt-2 text-sm text-rose-400">Could not read the chains just now. Try again in a moment.</p>}
      {!res && got !== "failed" && <ReadingNote key={key} />}
      {res && best && (
        <>
          <p className="mt-2 text-sm text-neutral-300">
            {stays ? (
              <>
                Staying on Base is the best use of this amount over {horizonText(res.days)}: the ETH fees to reach other chains would cost more than they add. It earns about{" "}
                <span className={`text-emerald-400 ${NUM}`}>${usd(best.usdPerDay)}</span> a day.
              </>
            ) : (
              <>
                About <span className={`text-emerald-400 ${NUM}`}>${usd(best.usdPerDay)}</span> a day across {best.chains.length} chains. After about{" "}
                <span className={NUM}>${usd(best.feeUsd)}</span> in one-off ETH fees, that is <span className={`text-neutral-100 ${NUM}`}>${usd(best.netUsd)}</span> over{" "}
                {horizonText(res.days)}
                {only ? (
                  <>
                    , against <span className={NUM}>${usd(only.netUsd)}</span> on Base alone ({extra >= 0 ? "+" : "−"}${usd(Math.abs(extra))})
                  </>
                ) : null}
                .
              </>
            )}
          </p>
          <ul className="mt-2 grid grid-cols-[minmax(0,1fr)] gap-1 text-sm text-neutral-300">
            {best.chains.map((c) => (
              <li key={c.chainId}>
                <span className="text-neutral-100">{c.name}</span> {c.pct}%:{" "}
                {c.parts.map((p, i) => (
                  <span key={p.gauge}>
                    {i > 0 && " · "}
                    {p.symbol} {p.pct}%
                  </span>
                ))}
                {c.feeUsd > 0 && <span className={NOTE}> (about ${usd(c.feeUsd)} in ETH to send power here)</span>}
              </li>
            ))}
          </ul>
          <p className={`mt-2 ${NOTE}`}>
            Fees are what Aero&rsquo;s own message adapter quotes now, paid in ETH on Base (ETH at ${Math.round(res.ethUsd ?? 0).toLocaleString("en-US")}), and come back as a further charge when power is
            moved off a chain later. Fee pace here is{" "}
            {best.confidence === "spiky" ? "spiky: a gauge in this split is releasing far more than usual" : `${best.confidence}, from ${Math.round(best.weakestHours)} hours of history in the weakest pick`}. Read{" "}
            {ago(res.generatedAt)}.
            {res.skipped.length > 0 && ` Left out because they could not be read just now: ${res.skipped.join(", ")}.`}
          </p>
          {!stays && (
            <p className={`mt-1 ${NOTE}`}>
              To act on it, connect your wallet and press &ldquo;allocate across chains…&rdquo; on a position below.
            </p>
          )}
        </>
      )}
    </div>
  );
}
