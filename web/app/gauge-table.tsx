"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { DISPLAY_PRESET } from "@/lib/protocol";
import type { GaugeList, GaugeRow } from "@/lib/gauges";
import type { GaugeFees } from "@/lib/gauge-fees-read";
import { aprPct, MIN_RANK_WEIGHT, paceLabel, rankByUsdPerDay, steadyLabel, steadySortScore, type YieldRow } from "@/lib/gauge-yield";
import { lowUsdPerDayOf } from "@/lib/projection";
import { formatFlow, topMovers, type Flow, type Flows } from "@/lib/weight-history";
import { parseAmount } from "@/lib/amount";
import { AERO_LAUNCH_AT_MS } from "./launch";
import { AERO_CHAINS, BASE_CHAIN } from "@/lib/aero-chains";
import { AllocationDesk, fmtApr } from "./allocation-desk";
import { GaugeHistoryPanel } from "./gauge-history";
import { btn, chip, H2, input, NOTE, NUM } from "./ui";

const SHOWN = 10;
const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 0 });
const usd2 = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const PACE_TONE = { thin: "text-amber-500", fair: "text-neutral-400", solid: "text-emerald-400", spiky: "text-amber-500" } as const;
const SPIKE_TITLE = "The recent fee pace is a burst far above this gauge's usual level, so the APR is shown as a range from the usual level up to the burst";

type SortKey = "you" | "fees" | "incentives" | "power" | "steady";
interface Line {
  g: GaugeRow;
  y: YieldRow | undefined;
}

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
    <th scope="col" aria-sort={active ? "descending" : undefined} className={`px-2 py-2 text-xs font-medium uppercase tracking-wide text-neutral-500 ${className}`}>
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
  const [data, setData] = useState<GaugeList | null>(null);
  const [failed, setFailed] = useState(false);
  const [all, setAll] = useState(false);
  const [fees, setFees] = useState<GaugeFees | null>(null);
  const [feesFailed, setFeesFailed] = useState(false);
  const [openGauge, setOpenGauge] = useState<string | null>(null);
  const [flows, setFlows] = useState<Flows | null>(null);
  const [amountText, setAmountText] = useState("10000");
  const [sortKey, setSortKey] = useState<SortKey>("you");

  const [chainId, setChainId] = useState<number>(BASE_CHAIN.id);
  const onBase = chainId === BASE_CHAIN.id;
  const cfg = AERO_CHAINS.find((c) => c.id === chainId);
  const chainName = cfg?.name ?? "";
  const explorer = cfg?.chain.blockExplorers?.default.url;
  const hasFees = !!cfg?.feeLogs;

  useEffect(() => {
    setLive(DISPLAY_PRESET.protocol === "aerodrome" && Date.now() >= AERO_LAUNCH_AT_MS);
  }, []);

  useEffect(() => {
    if (!live) return;
    let cancelled = false;
    setData(null);
    setFailed(false);
    setAll(false);
    setOpenGauge(null);
    fetch(`/api/gauges?chain=${chainId}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: GaugeList) => !cancelled && setData(d))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [live, chainId]);

  // Fee estimates come from a stored record of fee releases and take a few seconds the first time, so they load after the list.
  useEffect(() => {
    if (!live || !hasFees) return;
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
  }, [live, chainId, hasFees]);

  // Where power is moving comes from stored snapshots; it is empty for the first hours after they start, and the page works without it.
  useEffect(() => {
    if (!live) return;
    let cancelled = false;
    setFlows(null);
    fetch(`/api/gauge-flows?chain=${chainId}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: Flows) => !cancelled && Array.isArray(d.flows) && (d.flows.length > 0 || (d.newIncentives?.length ?? 0) > 0) && setFlows({ ...d, newIncentives: d.newIncentives ?? [] }))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [live, chainId]);

  const flowByGauge = useMemo(() => new Map((flows?.flows ?? []).map((f) => [f.gauge, f])), [flows]);
  const newByGauge = useMemo(() => new Map((flows?.newIncentives ?? []).map((n) => [n.gauge, n])), [flows]);
  const movers = useMemo(() => (flows ? topMovers(flows.flows) : null), [flows]);
  const nameOf = (gauge: string) => data?.gauges.find((g) => g.gauge.toLowerCase() === gauge)?.symbol ?? gauge.slice(0, 8);

  const parsed = parseAmount(amountText);
  const amount = parsed.ok ? parsed.value : 0;
  const estimating = hasFees && !!fees && parsed.ok;
  const showApr = estimating && !!fees?.aeroUsd;
  const lines = useMemo<Line[]>(() => {
    if (!data) return [];
    const byGauge = new Map((estimating && fees ? rankByUsdPerDay(data.gauges, fees.fees, amount) : []).map((y) => [y.gauge.toLowerCase(), y]));
    const out = data.gauges.map((g) => ({ g, y: byGauge.get(g.gauge.toLowerCase()) }));
    const key: SortKey = estimating ? sortKey : "power";
    return out.sort((a, b) => sortValue(b, key) - sortValue(a, key) || b.g.weight - a.g.weight);
  }, [data, fees, estimating, amount, sortKey]);
  if (!live) return null;
  const shown = all ? lines : lines.slice(0, SHOWN);

  return (
    <section id="gauges" className="mt-4 scroll-mt-36 rounded-xl border border-neutral-800 bg-neutral-900/40 px-3 py-4 sm:px-5">
      <h2 className={H2}>
        Where your sAERO earns the most on {chainName}
        {data ? <span className="font-normal text-neutral-500"> · {data.gauges.length} gauges</span> : ""}
      </h2>
      <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="chain">
        {AERO_CHAINS.map((c) => (
          <button key={c.id} type="button" className={chip(c.id === chainId)} aria-pressed={c.id === chainId} onClick={() => setChainId(c.id)}>
            {c.name}
          </button>
        ))}
      </div>
      {!onBase && (
        <p className="mt-3 text-sm text-amber-500">
          {hasFees
            ? `On ${chainName} you can see weights, caps, incentives and the $/day ranking. Allocating is Base only for now (Arc isn’t read yet); the cost line under the best split is what Aero charges to send power here.`
            : `On ${chainName} you can see weights, caps and incentives. Fee estimates aren’t measured here yet, and allocating is Base only for now.`}
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
          {fees && data && parsed.ok && <AllocationDesk gauges={data.gauges} fees={fees} amount={amount} chainName={chainName} />}
        </div>
      )}
      {failed && <p className="mt-3 text-sm text-rose-400">Couldn&rsquo;t load gauges. Try again in a moment.</p>}
      {!data && !failed && <p className={`mt-3 ${NOTE}`}>Loading gauges…</p>}
      {data && (
        <>
          {flows && flows.newIncentives.length > 0 && (
            <p className="mt-3 text-sm leading-relaxed text-neutral-400">
              <span className="text-neutral-500">New incentives, last day: </span>
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
              <span className="text-neutral-500">Power moving, last {Math.round(flows.spanHours)} h: </span>
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
                {shown.map(({ g, y }) => {
                  const conf = y ? paceLabel(y) : null;
                  const steady = y ? steadyLabel(y) : null;
                  const fresh = newByGauge.get(g.gauge.toLowerCase());
                  const incPerDay = g.incentivesUsdPerWeek / 7;
                  const apr = y ? aprPct(y.usdPerDay, amount, fees?.aeroUsd) : null;
                  // A spike shows its APR as a range: the gauge's usual level up to the burst.
                  const aprLow = y?.spike && apr !== null ? aprPct(lowUsdPerDayOf(y), amount, fees?.aeroUsd) : null;
                  const aprText = apr === null ? null : aprLow !== null && aprLow < apr ? `${fmtApr(aprLow)}–${fmtApr(apr)}` : fmtApr(apr);
                  const flow: Flow | undefined = flowByGauge.get(g.gauge.toLowerCase());
                  return (
                    <Fragment key={g.gauge}>
                    <tr className="border-b border-neutral-800/60 align-top last:border-0">
                      <td className="min-w-0 px-2 py-2.5">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                          {explorer ? (
                            <a href={`${explorer}/address/${g.pool}`} target="_blank" rel="noreferrer" title="Open the pool contract" className="break-words font-medium text-neutral-100 underline-offset-2 hover:text-sky-300 hover:underline">
                              {g.symbol}
                            </a>
                          ) : (
                            <span className="break-words font-medium text-neutral-100">{g.symbol}</span>
                          )}
                          {g.poolType && (
                            <span className="whitespace-nowrap rounded-md border border-neutral-700 px-1.5 py-0.5 text-xs text-neutral-400" title={g.feePct != null ? `Current fee ${g.feePct.toFixed(2)}%` : undefined}>
                              {g.poolType}
                              {g.feePct != null ? ` · ${g.feePct < 0.1 ? g.feePct.toFixed(3) : g.feePct.toFixed(2)}%` : ""}
                            </span>
                          )}
                        </div>
                        {fresh && (
                          <div className="mt-0.5 text-xs text-sky-400" title={`The last snapshot with no incentives was ${Math.max(1, Math.round(fresh.withinHours))} h ago`}>
                            new incentives · ${fmt(fresh.usdPerWeek)}/week, appeared within {Math.max(1, Math.round(fresh.withinHours))} h
                          </div>
                        )}
                        {!g.activated && <div className="text-xs text-amber-500">not activated</div>}
                        {hasFees && (
                          <button type="button" aria-expanded={openGauge === g.gauge} onClick={() => setOpenGauge(openGauge === g.gauge ? null : g.gauge)} className="mt-0.5 text-xs text-neutral-500 underline-offset-2 hover:text-sky-300 hover:underline">
                            {openGauge === g.gauge ? "hide history" : "history"}
                          </button>
                        )}
                        <div className="mt-0.5 text-xs leading-relaxed text-neutral-500 sm:hidden">
                          {aprText !== null ? `${aprText} APR · ` : ""}
                          {y ? `fees $${fmt(y.feesUsdPerDay)} · incentives $${fmt(y.incentivesUsdPerDay)} · ` : g.incentivesUsdPerWeek > 0 ? `incentives $${fmt(incPerDay)}/day · ` : ""}
                          {fmt(g.weight)} power
                          {conf ? <> · <span className={PACE_TONE[conf]}>{conf === "spiky" ? "spiky pace" : `${conf} pace`}</span></> : ""}
                          {steady ? ` · ${steady.kind === "incentives" ? "paid by incentives" : `steady ${steady.paying}/${steady.buckets}`}` : ""}
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
                      {showApr && <td className={`hidden px-2 py-2.5 text-right text-neutral-300 sm:table-cell ${NUM}`} title={y?.spike ? SPIKE_TITLE : undefined}>{aprText === null ? "–" : aprText}</td>}
                      {estimating && <td className={`hidden px-2 py-2.5 text-right text-neutral-300 sm:table-cell ${NUM}`}>{y ? `$${fmt(y.feesUsdPerDay)}` : "–"}</td>}
                      <td className={`hidden px-2 py-2.5 text-right text-neutral-300 sm:table-cell ${NUM}`}>{incPerDay > 0 ? `$${fmt(incPerDay)}` : "–"}</td>
                      <td className={`hidden px-2 py-2.5 text-right text-neutral-300 sm:table-cell ${NUM}`}>{fmt(g.weight)}</td>
                      {estimating && <td className={`hidden px-2 py-2.5 text-right text-neutral-400 sm:table-cell ${NUM}`}>{g.sharePct.toFixed(2)}%</td>}
                      {estimating && <td className={`hidden px-2 py-2.5 text-right sm:table-cell ${conf ? PACE_TONE[conf] : "text-neutral-600"}`} title={y?.spike ? SPIKE_TITLE : undefined}>{conf ?? "–"}</td>}
                      {estimating && (
                        <td className={`hidden px-2 py-2.5 text-right sm:table-cell ${NUM} ${steady && (steady.kind === "incentives" || steady.paying === steady.buckets) ? "text-neutral-200" : "text-neutral-400"}`} title={steady?.kind === "incentives" ? "Paid mostly by incentives, which stream at a fixed rate until their program ends" : "Complete half-days in which the gauge paid at least half its average in fees"}>
                          {steady ? (steady.kind === "incentives" ? "incentives" : `${steady.paying}/${steady.buckets}`) : "–"}
                        </td>
                      )}
                      {flows && (
                        <td className={`hidden px-2 py-2.5 text-right sm:table-cell ${NUM} ${flow && flow.sharePctChange >= 0.5 ? "text-sky-400" : "text-neutral-400"}`} title={flow ? `${flow.powerChange >= 0 ? "+" : "−"}${fmt(Math.abs(flow.powerChange))} power in ${Math.round(flows.spanHours)} h` : "Too new or too thin to compare"}>
                          {flow ? formatFlow(flow.sharePctChange) : "–"}
                        </td>
                      )}
                    </tr>
                    {openGauge === g.gauge && (
                      <tr className="border-b border-neutral-800/60 last:border-0">
                        <td colSpan={10} className="px-2 pb-3 pt-0">
                          <GaugeHistoryPanel chainId={chainId} gauge={g.gauge} />
                        </td>
                      </tr>
                    )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          {lines.length > SHOWN && (
            <button type="button" className={`mt-3 ${btn("secondary", "sm")}`} onClick={() => setAll((v) => !v)}>
              {all ? `show top ${SHOWN}` : `show all ${lines.length}`}
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
                Aero advises judging allocation over a long horizon, because results over a window as short as 47 hours are noisy.
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
        </>
      )}
    </section>
  );
}
