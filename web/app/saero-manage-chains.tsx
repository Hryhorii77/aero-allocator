"use client";

import { useEffect, useState } from "react";
import { formatEther, type Address } from "viem";
import { AERO_CHAINS } from "@/lib/aero-chains";
import { AllocateError } from "@/lib/allocate";
import type { CrossChainFee } from "@/lib/allocate-fee";
import { planChainRegauge, planChainReturn } from "@/lib/allocate-manage";
import { withMargin, type AllocateStep } from "@/lib/allocate-multichain";
import type { GaugeFees } from "@/lib/gauge-fees-read";
import { rankByUsdPerDay } from "@/lib/gauge-yield";
import { gaugeLabel, type GaugeList } from "@/lib/gauges";
import { readLeafChain, type LeafChainState } from "@/lib/leaf-read";
import { pendingLeftMs } from "@/lib/pending-lock";
import { cooldownState, formatDuration } from "@/lib/saero";
import { bestSplit } from "@/lib/split";
import { btn, NOTE, NUM } from "./ui";

const E18 = 10n ** 18n;
const eth = (wei: bigint) => Number(formatEther(wei)).toPrecision(2);
const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });

type Row = {
  chainId: number;
  name: string;
  amount: bigint;
  leaf: LeafChainState | null;
  current: Array<{ symbol: string; pct: number }>;
  best: Array<{ gauge: string; symbol: string; pct: number }> | null;
  same: boolean;
  quoteOne: CrossChainFee | null;
  quoteBest: CrossChainFee | null;
};

/**
 * What a position has on each other chain, read from that chain's own leaf voter in this browser, with two actions per chain: set the
 * best gauges for its power, or return it to idle. Power returned from another chain reaches Base only when Aero's message arrives (a few
 * minutes), after which it is idle and can be sent anywhere again with the buttons above. A chain still in its wait, or with a change still
 * on its way, offers nothing: the chain would only hold a second message until the wait ends and apply it late.
 */
export function SaeroManageChains({ tokenId, owner, byChain, power, busy, nonce, onSend }: { tokenId: bigint; owner: Address; byChain: Record<number, bigint>; power: number; busy: boolean; nonce: string; onSend: (step: AllocateStep, chainId: number) => void }) {
  const [rows, setRows] = useState<Row[] | null | "failed">(null);
  const [nowSec, setNowSec] = useState(() => Math.floor(Date.now() / 1000));
  const [problem, setProblem] = useState<string | null>(null);
  const key = Object.entries(byChain).map(([c, a]) => `${c}=${a}`).join(",");

  useEffect(() => {
    const t = setInterval(() => setNowSec(Math.floor(Date.now() / 1000)), 30_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    let live = true;
    setRows(null);
    (async () => {
      const chains = AERO_CHAINS.filter((c) => (byChain[c.id] ?? 0n) > 0n);
      const out = await Promise.all(
        chains.map(async (c): Promise<Row> => {
          const amount = byChain[c.id];
          const [leaf, g, f] = await Promise.all([
            readLeafChain(c.id, tokenId).catch(() => null),
            fetch(`/api/gauges?chain=${c.id}`).then((r) => (r.ok ? (r.json() as Promise<GaugeList>) : null)).catch(() => null),
            fetch(`/api/gauge-fees?chain=${c.id}`).then((r) => (r.ok ? (r.json() as Promise<GaugeFees>) : null)).catch(() => null),
          ]);
          const label = new Map((g?.gauges ?? []).map((x) => [x.gauge.toLowerCase(), gaugeLabel(x)]));
          const chainPower = Number(amount / (E18 / 1000n)) / 1000;
          const ranked = g && f ? rankByUsdPerDay(g.gauges, f.fees, chainPower) : [];
          const split = bestSplit(ranked.map((r) => ({ gauge: r.gauge, symbol: gaugeLabel(r), rate: r.feesUsdPerDay + r.incentivesUsdPerDay, weight: r.weight })), chainPower, 4);
          const best = split ? split.parts.map((p) => ({ gauge: String(p.gauge), symbol: p.symbol, pct: p.pct })) : null;
          const current = leaf && leaf.total > 0n ? leaf.gauges.map((x) => ({ symbol: label.get(x.gauge.toLowerCase()) ?? `${x.gauge.slice(0, 6)}…`, pct: Number((x.amount * 10_000n) / leaf.total) / 100, gauge: x.gauge })) : [];
          const same = !!best && current.length === best.length && best.every((b) => current.some((x) => (x as { gauge: string }).gauge.toLowerCase() === b.gauge.toLowerCase() && Math.abs(x.pct - b.pct) < 0.5));
          const quote = (n: number) => fetch(`/api/allocation-fee?chain=${c.id}&gauges=${n}`).then((r) => (r.ok ? (r.json() as Promise<CrossChainFee>) : null)).catch(() => null);
          const [quoteOne, quoteBest] = await Promise.all([quote(1), best && best.length !== 1 ? quote(best.length) : null]);
          return { chainId: c.id, name: c.name, amount, leaf, current, best, same, quoteOne, quoteBest: best?.length === 1 ? quoteOne : quoteBest };
        }),
      );
      if (live) setRows(out);
    })().catch(() => live && setRows("failed"));
    return () => {
      live = false;
    };
  }, [tokenId, key, nonce, byChain, power]);

  const run = (make: () => AllocateStep, chainId: number) => {
    setProblem(null);
    try {
      onSend(make(), chainId);
    } catch (e) {
      setProblem(e instanceof AllocateError ? e.message : "Could not plan this.");
    }
  };

  if (rows === null) return <p className={`mt-2 ${NOTE}`}>Reading this position on its other chains…</p>;
  if (rows === "failed") return <p className="mt-2 text-sm text-rose-400">Could not read the other chains just now. Try again in a moment.</p>;
  return (
    <div className="mt-3">
      <p className={NOTE}>
        This position has power on other chains. For each one you can set the best gauges for its power, or return it to idle. Returned power comes back to Base after Aero&rsquo;s message
        arrives, a few minutes later; after that it is idle and the buttons above can send it anywhere.
      </p>
      <ul className="mt-2 grid grid-cols-[minmax(0,1fr)] gap-2">
        {rows.map((r) => {
          const wait = r.leaf ? cooldownState(r.leaf.lastAllocatedSec, r.leaf.cooldownSec, nowSec) : null;
          const inFlight = !!r.leaf && r.leaf.total + r.leaf.idle !== r.amount;
          const lockedMs = pendingLeftMs(tokenId, r.chainId, nowSec * 1000);
          const blocked = busy || !r.leaf || (wait !== null && !wait.ready) || inFlight || lockedMs > 0;
          const why = !r.leaf
            ? `Could not read ${r.name}'s own node just now.`
            : wait && !wait.ready
              ? `${r.name}'s wait ends in ${formatDuration(wait.secondsLeft)}.`
              : inFlight || lockedMs > 0
                ? "A change is still on its way. Try again when Aero's message has arrived."
                : null;
          const fees = (n: CrossChainFee | null) => (n ? withMargin(BigInt(n.gaugeStep)) : 0n);
          return (
            <li key={r.chainId} className="rounded-lg border border-neutral-800 px-3 py-2 text-sm text-neutral-300">
              <div>
                <span className="text-neutral-100">{r.name}</span> <span className={NUM}>{fmt(Number(r.amount / (E18 / 100n)) / 100)}</span> power
                {r.leaf && r.leaf.idle > 0n && <span className={NOTE}> ({fmt(Number(r.leaf.idle / (E18 / 100n)) / 100)} of it idle there)</span>}
              </div>
              <div className={NOTE}>
                Now: {r.current.length > 0 ? r.current.map((x) => `${x.symbol} ${fmt(x.pct)}%`).join(" · ") : "no gauge set"}
                {r.best && !r.same ? ` · Best now: ${r.best.map((x) => `${x.symbol} ${fmt(x.pct)}%`).join(" · ")}` : ""}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  className={btn("primary", "sm")}
                  disabled={blocked || !r.best || r.same || !r.quoteBest}
                  onClick={() => run(() => planChainRegauge({ tokenId, chainId: r.chainId, amount: r.amount, picks: r.best!.map((b) => ({ gauge: b.gauge, bps: Math.round(b.pct * 100) })), fees: { gaugeStepWei: () => fees(r.quoteBest), returnCostWei: 0n }, refundRecipient: owner }), r.chainId)}
                >
                  {r.same ? "already on the best gauges" : "set the best gauges"}
                </button>
                <button
                  type="button"
                  className={btn("secondary", "sm")}
                  disabled={blocked || !r.quoteOne}
                  onClick={() => run(() => planChainReturn({ tokenId, chainId: r.chainId, amount: r.amount, fees: { gaugeStepWei: () => fees(r.quoteOne), returnCostWei: BigInt(r.quoteOne!.returnCost) }, refundRecipient: owner }), r.chainId)}
                >
                  return to idle
                </button>
                {r.quoteOne && !blocked && (
                  <span className={NOTE}>
                    about {eth(BigInt(r.quoteOne.gaugeStep))} ETH to set gauges, {eth(BigInt(r.quoteOne.gaugeStep) + BigInt(r.quoteOne.returnCost))} ETH to return
                  </span>
                )}
              </div>
              {why && <p className="mt-2 text-sm text-amber-500">{why}</p>}
            </li>
          );
        })}
      </ul>
      {problem && <p className="mt-2 text-sm text-rose-400">{problem}</p>}
    </div>
  );
}
