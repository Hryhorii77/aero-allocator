"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { DISPLAY_PRESET } from "@/lib/protocol";
import type { GaugeList, GaugeRow } from "@/lib/gauges";
import type { GaugeFees } from "@/lib/gauge-fees-read";
import { aprPct, incentiveEndText, isSteadiest, MIN_RANK_WEIGHT, paceLabel, rankByUsdPerDay, steadyLabel, steadySortScore, type YieldRow } from "@/lib/gauge-yield";
import { lowUsdPerDayOf } from "@/lib/projection";
import { DEFAULT_COOLDOWN_SEC, waitHours } from "@/lib/saero";
import { formatFlow, topMovers, type Flow, type Flows } from "@/lib/weight-history";
import { parseAmount } from "@/lib/amount";
import { AERO_LAUNCH_AT_MS } from "./launch";
import { AERO_CHAINS, BASE_CHAIN, chainById } from "@/lib/aero-chains";
import type { ChainCount } from "@/lib/chain-counts";
import { Glossary } from "./glossary";
import { QuickSplit } from "./quick-split";
import { AllChainsSplitPanel } from "./all-chains-split";
import { AllocationDesk, fmtApr } from "./allocation-desk";
import { GaugeHistoryPanel } from "./gauge-history";
import { btn, chip, H2, input, NOTE, NUM, TAG } from "./ui";

const SHOWN = 10;
const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 0 });
const usd2 = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const PACE_TONE = { thin: "text-amber-500", fair: "text-neutral-400", solid: "text-emerald-400", spiky: "text-amber-500" } as const;
const SPIKE_TITLE = "The recent fee pace is a burst far above this gauge's usual level, so the APR is shown as a range from the usual level up to the burst";

type SortKey = "you" | "fees" | "incentives" | "power" | "steady";
interface Line {
  g: GaugeRow;
  y: YieldRow | undefined;
  chainId: number;
}

/** Every chain's lists, loaded once for the "All networks" view (gauge addresses can repeat across chains, so they stay per chain). */
interface Multi {
  lists: GaugeList[];
  fees: Map<number, GaugeFees>;
}
const ALL = "all" as const;
const lineKey = (l: { chainId: number; g: GaugeRow }) => `${l.chainId}:${l.g.gauge.toLowerCase()}`;

/** What each line sorts by; a gauge with no estimate sorts after every gauge that has one. */
function sortValue(l: Line, key: SortKey): number {
  if (key === "power") return l.g.weight;
  if (!l.y) return -1;
  if (key === "steady") return steadySortScore(l.y) * 1e9 + l.y.usdPerDay;
  if (key === "you") return l.y.usdPerDay;
  if (key === "fees") return l.y.feesUsdPerDay;
  return l.y.incentivesUsdPerDay;
}

function Th({ children, sortKey, active, onSort, className = "" }: { children: string; sortKey?: SortKey; active?: boolean; onSort?: (k: SortKey) => void; className?: string }) {
  return (
    <th scope="col" aria-sort={active ? "descending" : undefined} className={`px-2 py-2 text-xs font-medium uppercase tracking-wide text-neutral-400 ${className}`}>
      {sortKey && onSort ? (
        <button type="button" onClick={() => onSort(sortKey)} className={`uppercase tracking-wide hover:text-neutral-200 ${active ? "text-sky-400" : ""}`}>
          {children}
          {active ? " ↓" : ""}
        </button>
      ) : (
        children
      )}
    </th>
  );
}

/**
 * One table of Aero gauges on a chain: what your amount earns in each per day, the fees and incentives behind it, the power already
 * there, and how much fee history the estimate rests on. On phones only the pool and what you earn are columns; the rest sit under
 * the pool name so nothing scrolls sideways.
 */
export function GaugeTable() {
  const [live, setLive] = useState(false);
  const [oneData, setData] = useState<GaugeList | null>(null);
  const [oneFailed, setFailed] = useState(false);
  const [all, setAll] = useState(false);
  const [oneFees, setFees] = useState<GaugeFees | null>(null);
  const [oneFeesFailed, setFeesFailed] = useState(false);
  const [multi, setMulti] = useState<Multi | null>(null);
  const [multiFailed, setMultiFailed] = useState(false);
  const [counts, setCounts] = useState<Map<number, number> | null>(null);
  const [openGauge, setOpenGauge] = useState<string | null>(null);
  const [flows, setFlows] = useState<Flows | null>(null);
  const [amountText, setAmountText] = useState("10000");
  const [sortKey, setSortKey] = useState<SortKey>("you");
  // Phones start on the short answer (the quick split); this unfolds the long explanations and the whole table. From `sm` up everything is always shown.
  const [more, setMore] = useState(false);
  const [steadyOnly, setSteadyOnly] = useState(false);
  // Gauges Aero has not activated earn nothing and can't be ranked, so they sit behind a button instead of among the real ones.
  const [showInactive, setShowInactive] = useState(false);

  const [sel, setSel] = useState<number | typeof ALL>(BASE_CHAIN.id);
  const allMode = sel === ALL;
  // In the "All networks" view the single-chain reads are idle; chainId then only names Base for the panels that stay Base's.
  const chainId = allMode ? BASE_CHAIN.id : sel;
  const onBase = !allMode && chainId === BASE_CHAIN.id;
  const cfg = AERO_CHAINS.find((c) => c.id === chainId);
  const chainName = allMode ? "every network" : cfg?.name ?? "";
  const hasFees = allMode || !!cfg?.feeLogs;

  useEffect(() => {
    setLive(DISPLAY_PRESET.protocol === "aerodrome" && Date.now() >= AERO_LAUNCH_AT_MS);
  }, []);

  // The number on each chain button: gauges that can be ranked there. One small cached read; a button without a number still works.
  useEffect(() => {
    if (!live) return;
    let cancelled = false;
    fetch("/api/chain-counts")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { counts?: ChainCount[] }) => !cancelled && Array.isArray(d.counts) && setCounts(new Map(d.counts.map((c) => [c.chainId, c.ranked]))))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [live]);

  // "All networks": every chain's gauges and fees, read once and kept, so switching back and forth doesn't read seven chains again.
  useEffect(() => {
    if (!live || !allMode || multi) return;
    let cancelled = false;
    const json = (url: string) => fetch(url).then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))));
    Promise.allSettled(AERO_CHAINS.map((c) => Promise.all([json(`/api/gauges?chain=${c.id}`) as Promise<GaugeList>, (json(`/api/gauge-fees?chain=${c.id}`) as Promise<GaugeFees>).catch(() => null)])))
      .then((res) => {
        if (cancelled) return;
        const lists: GaugeList[] = [];
        const fees = new Map<number, GaugeFees>();
        res.forEach((r, i) => {
          if (r.status !== "fulfilled" || !Array.isArray(r.value[0]?.gauges)) return;
          lists.push({ ...r.value[0], chainId: AERO_CHAINS[i].id });
          if (r.value[1] && Array.isArray(r.value[1].fees)) fees.set(AERO_CHAINS[i].id, r.value[1]);
        });
        if (lists.length === 0) setMultiFailed(true);
        else setMulti({ lists, fees });
      });
    return () => {
      cancelled = true;
    };
  }, [live, allMode, multi]);

  useEffect(() => {
    if (!live || allMode) return;
    let cancelled = false;
    setData(null);
    setFailed(false);
    setAll(false);
    setShowInactive(false);
    setOpenGauge(null);
    fetch(`/api/gauges?chain=${chainId}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: GaugeList) => !cancelled && setData(d))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [live, chainId, allMode]);

  // Fee estimates come from a stored record of fee releases and take a few seconds the first time, so they load after the list.
  useEffect(() => {
    if (!live || allMode || !hasFees) return;
    let cancelled = false;
    setFees(null);
    setFeesFailed(false);
    fetch(`/api/gauge-fees?chain=${chainId}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: GaugeFees) => !cancelled && setFees(d))
      .catch(() => !cancelled && setFeesFailed(true));
    return () => {
      cancelled = true;
    };
  }, [live, chainId, allMode, hasFees]);

  // Where power is moving comes from stored snapshots; it is empty for the first hours after they start, and the page works without it.
  useEffect(() => {
    setFlows(null);
    if (!live || allMode) return;
    let cancelled = false;
    fetch(`/api/gauge-flows?chain=${chainId}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: Flows) => !cancelled && Array.isArray(d.flows) && (d.flows.length > 0 || (d.newIncentives?.length ?? 0) > 0) && setFlows({ ...d, newIncentives: d.newIncentives ?? [] }))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [live, chainId, allMode]);

  // The render below reads `data` and `fees` either way: one chain's lists, or every chain's merged for the counts, footnotes and APR.
  const baseList = multi?.lists.find((l) => l.chainId === BASE_CHAIN.id);
  const data: GaugeList | null = !allMode
    ? oneData
    : multi
      ? { chainId: 0, generatedAt: Math.max(...multi.lists.map((l) => l.generatedAt)), totalWeight: 0, gauges: multi.lists.flatMap((l) => l.gauges), cooldownSec: baseList?.cooldownSec }
      : null;
  const fees: GaugeFees | null = !allMode
    ? oneFees
    : multi && multi.fees.size > 0
      ? (() => {
          const all = [...multi.fees.values()];
          return { chainId: 0, generatedAt: Math.max(...all.map((f) => f.generatedAt)), windowHours: (multi.fees.get(BASE_CHAIN.id) ?? all[0]).windowHours, fees: all.flatMap((f) => f.fees), aeroUsd: all.find((f) => f.aeroUsd)?.aeroUsd ?? null };
        })()
      : null;
  const failed = allMode ? multiFailed : oneFailed;
  const feesFailed = allMode ? !!multi && multi.fees.size === 0 : oneFeesFailed;

  const flowByGauge = useMemo(() => new Map((flows?.flows ?? []).map((f) => [f.gauge, f])), [flows]);
  const newByGauge = useMemo(() => new Map((flows?.newIncentives ?? []).map((n) => [n.gauge, n])), [flows]);
  const movers = useMemo(() => (flows ? topMovers(flows.flows) : null), [flows]);
  const nameOf = (gauge: string) => data?.gauges.find((g) => g.gauge.toLowerCase() === gauge)?.symbol ?? gauge.slice(0, 8);

  const parsed = parseAmount(amountText);
  const amount = parsed.ok ? parsed.value : 0;
  const estimating = hasFees && !!fees && parsed.ok;
  const showApr = estimating && !!fees?.aeroUsd;
  const lines = useMemo<Line[]>(() => {
    // Each chain is ranked against its own fees (the same address can be a different gauge on another chain), then the lists are merged.
    const sources: { chainId: number; list: GaugeList; fees: GaugeFees | null | undefined }[] = allMode
      ? (multi?.lists ?? []).map((list) => ({ chainId: list.chainId, list, fees: multi?.fees.get(list.chainId) }))
      : oneData
        ? [{ chainId, list: oneData, fees: oneFees }]
        : [];
    const out = sources.flatMap(({ chainId: id, list, fees: f }) => {
      // Only Base's list carries the live wait; elsewhere the ranking falls back to the default, as on each chain's own view.
      const ranked = estimating && f ? rankByUsdPerDay(list.gauges, f.fees, amount, undefined, { waitSec: list.cooldownSec }) : [];
      const byGauge = new Map(ranked.map((y) => [y.gauge.toLowerCase(), y]));
      return list.gauges.map((g) => ({ g, y: byGauge.get(g.gauge.toLowerCase()), chainId: id }));
    });
    const key: SortKey = estimating ? sortKey : "power";
    return out.sort((a, b) => sortValue(b, key) - sortValue(a, key) || b.g.weight - a.g.weight);
  }, [allMode, multi, oneData, oneFees, chainId, estimating, amount, sortKey]);
  if (!live) return null;
  const rankedCount = lines.filter((l) => l.y).length;
  const steadyCount = lines.filter((l) => l.y && isSteadiest(l.y)).length;
  const filtered = steadyOnly && estimating ? lines.filter((l) => l.y && isSteadiest(l.y)) : lines;
  const activeLines = filtered.filter((l) => l.g.activated);
  const inactiveLines = filtered.filter((l) => !l.g.activated);
  const pool = showInactive ? [...activeLines, ...inactiveLines] : activeLines;
  const shown = all ? pool : pool.slice(0, SHOWN);
  // With the quick split on screen (phones, once an amount is priced) the rest is folded away until asked for.
  const fold = estimating && !!data && !more && !allMode ? "hidden sm:block" : "";
  const chipCount = (n: number | undefined) => (n === undefined ? null : <>
        {" "}
        <span className={`opacity-70 ${NUM}`}>{n}</span>
      </>);
  const totalCount = counts && counts.size > 0 ? [...counts.values()].reduce((a, b) => a + b, 0) : undefined;

  return (
    <section id="gauges" className="mt-4 scroll-mt-36 rounded-xl border border-neutral-800 bg-neutral-900/40 px-3 py-4 sm:px-5">
      <h2 className={H2}>
        Where your sAERO earns the most on {chainName}
        {data ? <span className="font-normal text-neutral-400"> · {data.gauges.length} gauges</span> : ""}
      </h2>
      <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="chain">
        <button type="button" className={chip(allMode)} aria-pressed={allMode} onClick={() => { setMultiFailed(false); setSel(ALL); }} title="Every network in one list">
          All networks{chipCount(totalCount)}
        </button>
        {AERO_CHAINS.map((c) => (
          <button
            key={c.id}
            type="button"
            className={chip(!allMode && c.id === chainId)}
            aria-pressed={!allMode && c.id === chainId}
            onClick={() => setSel(c.id)}
            title={counts?.has(c.id) ? `${counts.get(c.id)} gauges on ${c.name} can be ranked (activated, at least ${fmt(MIN_RANK_WEIGHT)} power)` : undefined}
          >
            {c.name}
            {chipCount(counts?.get(c.id))}
          </button>
        ))}
      </div>
      {allMode && (
        <p className={`mt-3 ${NOTE}`}>
          Every network in one list, each gauge ranked against its own chain. Sending power to a chain other than Base costs a one-off ETH fee that
          this list leaves out; &ldquo;compare all chains&rdquo; below weighs it and gives the best split over every network.
        </p>
      )}
      {!onBase && !allMode && (
        <p className="mt-3 text-sm text-amber-500">
          {hasFees
            ? `On ${chainName} you can see weights, caps, incentives and the $/day ranking. To allocate here, use “allocate across chains…” on a position below; the cost line under the best split is what Aero charges to send power to ${chainName}.`
            : `On ${chainName} you can see weights, caps and incentives. Fee estimates aren’t measured here yet. To allocate here, use “allocate across chains…” on a position below.`}
        </p>
      )}
      {hasFees && (
        <div className="mt-4">
          <label className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm text-neutral-400">
            <span>I hold</span>
            <input
              type="text"
              inputMode="decimal"
              value={amountText}
              onChange={(e) => setAmountText(e.target.value)}
              aria-label="sAERO amount"
              aria-invalid={!parsed.ok}
              aria-describedby={parsed.ok ? undefined : "amount-error"}
              className={input(!parsed.ok, `w-32 text-right ${NUM}`)}
            />
            <span>sAERO</span>
          </label>
          {!parsed.ok && (
            <p id="amount-error" role="alert" className="mt-1.5 text-sm text-rose-400">
              {parsed.error}
            </p>
          )}
          {!fees && !feesFailed && <p className={`mt-3 ${NOTE}`}>Reading fees from recent blocks…</p>}
          {feesFailed && <p className="mt-3 text-sm text-amber-500">Fee estimates are unavailable right now.</p>}
          {fees && data && parsed.ok && !allMode && (
            <div className="sm:hidden">
              <QuickSplit gauges={data.gauges} fees={fees} amount={amount} cooldownSec={data.cooldownSec} />
              <button type="button" aria-expanded={more} className={`mt-3 w-full ${btn("secondary", "md")}`} onClick={() => setMore((v) => !v)}>
                {more ? "hide the details" : "more: explanations, all chains and every gauge"}
              </button>
            </div>
          )}
          <div className={fold}>
            {fees && data && parsed.ok && !allMode && <AllocationDesk gauges={data.gauges} fees={fees} amount={amount} chainName={chainName} cooldownSec={data.cooldownSec} />}
            {fees && data && parsed.ok && <AllChainsSplitPanel amount={amount} />}
          </div>
        </div>
      )}
      {failed && <p className="mt-3 text-sm text-rose-400">Couldn&rsquo;t load gauges. Try again in a moment.</p>}
      {!data && !failed && <p className={`mt-3 ${NOTE}`}>Loading gauges…</p>}
      {data && (
        <div className={fold}>
          {flows && flows.newIncentives.length > 0 && (
            <p className="mt-3 text-sm leading-relaxed text-neutral-400">
              <span className="text-neutral-400">New incentives, last day: </span>
              {flows.newIncentives.slice(0, 4).map((n, i) => (
                <span key={n.gauge}>
                  {i > 0 ? ", " : ""}
                  <span className="text-neutral-200">{nameOf(n.gauge)}</span> <span className={`text-sky-400 ${NUM}`}>${fmt(n.usdPerWeek)}/week</span>
                </span>
              ))}
              . The first to allocate get the best rate; it falls as power joins.
            </p>
          )}
          {flows && movers && (movers.gaining.length > 0 || movers.losing.length > 0) && (
            <p className="mt-3 text-sm leading-relaxed text-neutral-400">
              <span className="text-neutral-400">Power moving, last {Math.round(flows.spanHours)} h: </span>
              {movers.gaining.length > 0 && (
                <>
                  gaining{" "}
                  {movers.gaining.map((f, i) => (
                    <span key={f.gauge}>
                      {i > 0 ? ", " : ""}
                      <span className="text-neutral-200">{nameOf(f.gauge)}</span> <span className={`text-sky-400 ${NUM}`}>{formatFlow(f.sharePctChange)}</span>
                    </span>
                  ))}
                </>
              )}
              {movers.gaining.length > 0 && movers.losing.length > 0 ? "; " : ""}
              {movers.losing.length > 0 && (
                <>
                  losing{" "}
                  {movers.losing.map((f, i) => (
                    <span key={f.gauge}>
                      {i > 0 ? ", " : ""}
                      <span className="text-neutral-200">{nameOf(f.gauge)}</span> <span className={NUM}>{formatFlow(f.sharePctChange)}</span>
                    </span>
                  ))}
                </>
              )}
              .
            </p>
          )}
          <Glossary flowHours={flows?.spanHours} />
          {estimating && (
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button type="button" aria-pressed={steadyOnly} className={chip(steadyOnly)} onClick={() => { setSteadyOnly((v) => !v); setAll(false); }} title="Gauges whose every complete half-day paid, or that incentives pay past the wait; bursts and gauges with no record yet are left out">
                steadiest only
              </button>
              {steadyOnly && <span className={NOTE}>{steadyCount} of {rankedCount} ranked gauges</span>}
            </div>
          )}
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-0 border-collapse text-sm">
              <caption className="sr-only">Aero gauges on {chainName}</caption>
              <thead>
                <tr className="border-b border-neutral-800 text-left">
                  <Th>Pool</Th>
                  <Th className="text-right" sortKey={estimating ? "you" : undefined} active={estimating && sortKey === "you"} onSort={setSortKey}>
                    {estimating ? "You earn / day" : "Share of weight"}
                  </Th>
                  {showApr && <Th className="hidden text-right sm:table-cell">Est. APR</Th>}
                  {estimating && (
                    <Th className="hidden text-right sm:table-cell" sortKey="fees" active={sortKey === "fees"} onSort={setSortKey}>
                      Fees / day
                    </Th>
                  )}
                  <Th className="hidden text-right sm:table-cell" sortKey={estimating ? "incentives" : undefined} active={estimating && sortKey === "incentives"} onSort={setSortKey}>
                    Incentives / day
                  </Th>
                  <Th className="hidden text-right sm:table-cell" sortKey={estimating ? "power" : undefined} active={estimating && sortKey === "power"} onSort={setSortKey}>
                    Power in it
                  </Th>
                  {estimating && <Th className="hidden text-right sm:table-cell">Share of weight</Th>}
                  {estimating && <Th className="hidden text-right sm:table-cell">Pace</Th>}
                  {estimating && (
                    <Th className="hidden text-right sm:table-cell" sortKey="steady" active={sortKey === "steady"} onSort={setSortKey}>
                      Steady
                    </Th>
                  )}
                  {flows && <Th className="hidden text-right sm:table-cell">Power flow</Th>}
                </tr>
              </thead>
              <tbody>
                {shown.map((line) => {
                  const { g, y } = line;
                  const key = lineKey(line);
                  const lineChain = chainById(line.chainId);
                  const explorer = lineChain?.chain.blockExplorers?.default.url;
                  const conf = y ? paceLabel(y) : null;
                  const steady = y ? steadyLabel(y) : null;
                  const fresh = newByGauge.get(g.gauge.toLowerCase());
                  const endText = y && data ? incentiveEndText(y, Math.floor(data.generatedAt / 1000), data.cooldownSec ?? DEFAULT_COOLDOWN_SEC) : null;
                  const incPerDay = g.incentivesUsdPerWeek / 7;
                  const apr = y ? aprPct(y.usdPerDay, amount, fees?.aeroUsd) : null;
                  // A spike shows its APR as a range: the gauge's usual level up to the burst.
                  const aprLow = y?.spike && apr !== null ? aprPct(lowUsdPerDayOf(y), amount, fees?.aeroUsd) : null;
                  const aprText = apr === null ? null : aprLow !== null && aprLow < apr ? `${fmtApr(aprLow)}–${fmtApr(apr)}` : fmtApr(apr);
                  const flow: Flow | undefined = flowByGauge.get(g.gauge.toLowerCase());
                  return (
                    <Fragment key={key}>
                    <tr className="border-b border-neutral-800/60 align-top last:border-0">
                      <td className="min-w-0 px-2 py-2.5">
                        {/* Same two lines on every row: the name alone, then its labels and "history". Side by side, a long name pushed the
                            label onto its own line on some rows only, so the column didn't line up. */}
                        <div>
                          {explorer ? (
                            <a href={`${explorer}/address/${g.pool}`} target="_blank" rel="noreferrer" title="Open the pool contract" className="break-words font-medium text-neutral-100 underline-offset-2 hover:text-sky-300 hover:underline">
                              {g.symbol}
                            </a>
                          ) : (
                            <span className="break-words font-medium text-neutral-100">{g.symbol}</span>
                          )}
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                          {allMode && lineChain && <span className={`${TAG} text-neutral-300`}>{lineChain.name}</span>}
                          {g.poolType && (
                            <span className={`${TAG} text-neutral-400`} title={g.feePct != null ? `Current fee ${g.feePct.toFixed(2)}%` : undefined}>
                              {g.poolType}
                              {g.feePct != null ? ` · ${g.feePct < 0.1 ? g.feePct.toFixed(3) : g.feePct.toFixed(2)}%` : ""}
                            </span>
                          )}
                          {hasFees && (
                            <button type="button" aria-expanded={openGauge === key} onClick={() => setOpenGauge(openGauge === key ? null : key)} className="text-xs text-neutral-500 underline-offset-2 hover:text-sky-300 hover:underline">
                              {openGauge === key ? "hide history" : "history"}
                            </button>
                          )}
                        </div>
                        {fresh && (
                          <div className="mt-0.5 text-xs text-sky-400" title={`The last snapshot with no incentives was ${Math.max(1, Math.round(fresh.withinHours))} h ago`}>
                            new incentives · ${fmt(fresh.usdPerWeek)}/week, appeared within {Math.max(1, Math.round(fresh.withinHours))} h
                          </div>
                        )}
                        {endText && (
                          <div className="mt-0.5 text-xs text-amber-500" title="These incentives stop streaming inside the wait, so the low case counts them only until then. A program can be renewed.">
                            {endText}
                          </div>
                        )}
                        {!g.activated && <div className="text-xs text-amber-500">not activated</div>}
                        <div className="mt-0.5 text-xs leading-relaxed text-neutral-500 sm:hidden">
                          {aprText !== null ? `${aprText} APR · ` : ""}
                          {y ? `fees $${fmt(y.feesUsdPerDay)} · incentives $${fmt(y.incentivesUsdPerDay)} · ` : g.incentivesUsdPerWeek > 0 ? `incentives $${fmt(incPerDay)}/day · ` : ""}
                          {fmt(g.weight)} power
                          {conf ? <> · <span className={PACE_TONE[conf]}>{conf === "spiky" ? "spiky pace" : `${conf} pace`}</span></> : ""}
                          {steady ? ` · ${steady.kind === "incentives" ? (steady.endsSoon ? "paid by incentives that end" : "paid by incentives") : `steady ${steady.paying}/${steady.buckets}`}` : ""}
                          {flow ? <> · <span className={flow.sharePctChange >= 0.5 ? "text-sky-400" : ""}>{formatFlow(flow.sharePctChange)} power</span></> : ""}
                        </div>
                      </td>
                      <td className={`px-2 py-2.5 text-right ${NUM}`}>
                        {estimating ? (
                          y ? (
                            <span className="text-emerald-400">${usd2(y.usdPerDay)}</span>
                          ) : (
                            <span className="text-neutral-600" title={g.weight < MIN_RANK_WEIGHT ? `Under ${fmt(MIN_RANK_WEIGHT)} power, too thin to rank` : "No fee estimate yet"}>
                              –
                            </span>
                          )
                        ) : (
                          <span className="text-neutral-300">{g.sharePct.toFixed(2)}%</span>
                        )}
                      </td>
                      {showApr && <td className={`hidden whitespace-nowrap px-2 py-2.5 text-right text-neutral-300 sm:table-cell ${NUM}`} title={y?.spike ? SPIKE_TITLE : undefined}>{aprText === null ? "–" : aprText}</td>}
                      {estimating && <td className={`hidden px-2 py-2.5 text-right text-neutral-300 sm:table-cell ${NUM}`}>{y ? `$${fmt(y.feesUsdPerDay)}` : "–"}</td>}
                      <td className={`hidden px-2 py-2.5 text-right text-neutral-300 sm:table-cell ${NUM}`}>{incPerDay > 0 ? `$${fmt(incPerDay)}` : "–"}</td>
                      <td className={`hidden px-2 py-2.5 text-right text-neutral-300 sm:table-cell ${NUM}`}>{fmt(g.weight)}</td>
                      {estimating && <td className={`hidden px-2 py-2.5 text-right text-neutral-400 sm:table-cell ${NUM}`}>{g.sharePct.toFixed(2)}%</td>}
                      {estimating && <td className={`hidden px-2 py-2.5 text-right sm:table-cell ${conf ? PACE_TONE[conf] : "text-neutral-600"}`} title={y?.spike ? SPIKE_TITLE : undefined}>{conf ?? "–"}</td>}
                      {estimating && (
                        <td className={`hidden px-2 py-2.5 text-right sm:table-cell ${NUM} ${steady && ((steady.kind === "incentives" && !steady.endsSoon) || (steady.kind === "fees" && steady.paying === steady.buckets)) ? "text-neutral-200" : "text-neutral-400"}`} title={steady?.kind === "incentives" ? (steady.endsSoon ? "Paid mostly by incentives, and some of them end inside the wait" : "Paid mostly by incentives, which stream at a fixed rate until their program ends") : "Complete half-days in which the gauge paid at least half its average in fees"}>
                          {steady ? (steady.kind === "incentives" ? (steady.endsSoon ? "incentives (ending)" : "incentives") : `${steady.paying}/${steady.buckets}`) : "–"}
                        </td>
                      )}
                      {flows && (
                        <td className={`hidden px-2 py-2.5 text-right sm:table-cell ${NUM} ${flow && flow.sharePctChange >= 0.5 ? "text-sky-400" : "text-neutral-400"}`} title={flow ? `${flow.powerChange >= 0 ? "+" : "−"}${fmt(Math.abs(flow.powerChange))} power in ${Math.round(flows.spanHours)} h` : "Too new or too thin to compare"}>
                          {flow ? formatFlow(flow.sharePctChange) : "–"}
                        </td>
                      )}
                    </tr>
                    {openGauge === key && (
                      <tr className="border-b border-neutral-800/60 last:border-0">
                        <td colSpan={10} className="px-2 pb-3 pt-0">
                          <GaugeHistoryPanel chainId={line.chainId} gauge={g.gauge} />
                        </td>
                      </tr>
                    )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          {steadyOnly && estimating && pool.length === 0 && <p className={`mt-3 ${NOTE}`}>No gauge has a clean fee record right now. Turn the filter off to see them all.</p>}
          {pool.length > SHOWN && (
            <button type="button" className={`mt-3 ${btn("secondary", "sm")}`} onClick={() => setAll((v) => !v)}>
              {all ? `show top ${SHOWN}` : `show all ${pool.length}`}
            </button>
          )}
          {inactiveLines.length > 0 && (
            <button type="button" aria-pressed={showInactive} className={`mt-3 ${all || pool.length > SHOWN ? "ml-2 " : ""}${btn("secondary", "sm")}`} onClick={() => setShowInactive((v) => !v)} title="Gauges Aero has not activated: they earn nothing yet">
              {showInactive ? "hide not activated" : `show ${inactiveLines.length} not activated`}
            </button>
          )}
          <p className={`mt-3 ${NOTE}`}>
            {estimating && fees ? (
              <>
                &ldquo;You earn&rdquo; is what {fmt(amount)} sAERO would make per day in that gauge alone, after it joins the power already there. Fees
                are the pace of the last ~{Math.round(fees.windowHours)} hours, not a promise (&ldquo;thin&rdquo; means under 6 hours of history); a gauge with no fee history or under {fmt(MIN_RANK_WEIGHT)} power
                shows a dash. {fees.fees.length} of {data.gauges.length} gauges have a measurable pace.
                {fees.aeroUsd ? (
                  <> Est. APR is that figure over a year as a share of your amount at AERO&rsquo;s price (${fees.aeroUsd.toFixed(2)}). The amount is voting power; a lock shorter than the maximum holds more AERO than power, so APR on the AERO you staked is lower. Aero&rsquo;s own APR uses its own method and can differ.</>
                ) : null}{" "}
                Aero advises judging allocation over a long horizon, because results over a window as short as {waitHours(data.cooldownSec ?? DEFAULT_COOLDOWN_SEC)} hours are noisy.
              </>
            ) : (
              <>Weight is each gauge&rsquo;s share of the allocation weight on {chainName}. Incentives are what projects are streaming to it now.</>
            )}
          </p>
          {flows && (
            <p className={`mt-2 ${NOTE}`}>
              Power flow is the change in a gauge&rsquo;s share of all allocation weight on {chainName} over the last {Math.round(flows.spanHours)} hours, so the slow
              drop from expiring locks doesn&rsquo;t count. A gauge that is filling up earns less per unit of power. It shows where power went, not where it will go.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
