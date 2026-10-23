"use client";

import { useEffect, useMemo, useState } from "react";
import { DISPLAY_PRESET } from "@/lib/protocol";
import type { GaugeList, GaugeRow } from "@/lib/gauges";
import type { GaugeFees } from "@/lib/gauge-fees-read";
import { MIN_RANK_WEIGHT, paceConfidence, rankByUsdPerDay, type YieldRow } from "@/lib/gauge-yield";
import { parseAmount } from "@/lib/amount";
import { AERO_LAUNCH_AT_MS } from "./launch";
import { AERO_CHAINS, BASE_CHAIN } from "@/lib/aero-chains";
import { AllocationDesk } from "./allocation-desk";
import { btn, chip, H2, input, NOTE, NUM } from "./ui";

const SHOWN = 10;
const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 0 });
const usd2 = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const PACE_TONE = { thin: "text-amber-500", fair: "text-neutral-400", solid: "text-emerald-400" } as const;

type SortKey = "you" | "fees" | "incentives" | "power";
interface Line {
  g: GaugeRow;
  y: YieldRow | undefined;
}

/** What each line sorts by; a gauge with no estimate sorts after every gauge that has one. */
function sortValue(l: Line, key: SortKey): number {
  if (key === "power") return l.g.weight;
  if (!l.y) return -1;
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

  const parsed = parseAmount(amountText);
  const amount = parsed.ok ? parsed.value : 0;
  const estimating = hasFees && !!fees && parsed.ok;
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
    <section className="mt-4 rounded-xl border border-neutral-800 bg-neutral-900/40 px-3 py-4 sm:px-5">
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
            ? `On ${chainName} you can see weights, caps, incentives and the $/day ranking. Allocating is Base only for now (Arc isn’t read yet).`
            : `On ${chainName} you can see weights, caps and incentives. Fee estimates and the ranking aren’t measured here (public nodes keep too little log history for its block time), and allocating is Base only for now.`}
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
          {fees && data && parsed.ok && <AllocationDesk gauges={data.gauges} fees={fees} amount={amount} />}
        </div>
      )}
      {failed && <p className="mt-3 text-sm text-rose-400">Couldn&rsquo;t load gauges. Try again in a moment.</p>}
      {!data && !failed && <p className={`mt-3 ${NOTE}`}>Loading gauges…</p>}
      {data && (
        <>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-0 border-collapse text-sm">
              <caption className="sr-only">Aero gauges on {chainName}</caption>
              <thead>
                <tr className="border-b border-neutral-800 text-left">
                  <Th>Pool</Th>
                  <Th className="text-right" sortKey={estimating ? "you" : undefined} active={estimating && sortKey === "you"} onSort={setSortKey}>
                    {estimating ? "You earn / day" : "Share of weight"}
                  </Th>
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
                </tr>
              </thead>
              <tbody>
                {shown.map(({ g, y }) => {
                  const conf = y ? paceConfidence(y.windowHours) : null;
                  const incPerDay = g.incentivesUsdPerWeek / 7;
                  return (
                    <tr key={g.gauge} className="border-b border-neutral-800/60 align-top last:border-0">
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
                        {!g.activated && <div className="text-xs text-amber-500">not activated</div>}
                        <div className="mt-0.5 text-xs leading-relaxed text-neutral-500 sm:hidden">
                          {y ? `fees $${fmt(y.feesUsdPerDay)} · incentives $${fmt(y.incentivesUsdPerDay)} · ` : g.incentivesUsdPerWeek > 0 ? `incentives $${fmt(incPerDay)}/day · ` : ""}
                          {fmt(g.weight)} power
                          {conf ? <> · <span className={PACE_TONE[conf]}>{conf} pace</span></> : ""}
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
                      {estimating && <td className={`hidden px-2 py-2.5 text-right text-neutral-300 sm:table-cell ${NUM}`}>{y ? `$${fmt(y.feesUsdPerDay)}` : "–"}</td>}
                      <td className={`hidden px-2 py-2.5 text-right text-neutral-300 sm:table-cell ${NUM}`}>{incPerDay > 0 ? `$${fmt(incPerDay)}` : "–"}</td>
                      <td className={`hidden px-2 py-2.5 text-right text-neutral-300 sm:table-cell ${NUM}`}>{fmt(g.weight)}</td>
                      {estimating && <td className={`hidden px-2 py-2.5 text-right text-neutral-400 sm:table-cell ${NUM}`}>{g.sharePct.toFixed(2)}%</td>}
                      {estimating && <td className={`hidden px-2 py-2.5 text-right sm:table-cell ${conf ? PACE_TONE[conf] : "text-neutral-600"}`}>{conf ?? "–"}</td>}
                    </tr>
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
              </>
            ) : (
              <>Weight is each gauge&rsquo;s share of the allocation weight on {chainName}. Incentives are what projects are streaming to it now.</>
            )}
          </p>
        </>
      )}
    </section>
  );
}
