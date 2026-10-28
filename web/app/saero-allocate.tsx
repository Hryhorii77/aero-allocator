"use client";

import { useEffect, useMemo, useState } from "react";
import { useAccount, useSwitchChain, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { readContract, readContracts, simulateContract } from "wagmi/actions";
import { base } from "wagmi/chains";
import type { Address } from "viem";
import { gaugeLabel, type GaugeList } from "@/lib/gauges";
import type { GaugeFees } from "@/lib/gauge-fees-read";
import type { YieldRow } from "@/lib/gauge-yield";
import { analysePosition } from "@/lib/position-advice";
import type { Split } from "@/lib/split";
import { AllocateError, allocateAbi, allocateArgs, explainAllocateError, MAX_GAUGES, planAllocation } from "@/lib/allocate";
import { DEFAULT_COOLDOWN_SEC, SAERO, saeroLeafAbi, waitHours, type SaeroPosition } from "@/lib/saero";
import { BODY, btn, chip, input as inputCls, LINK, NOTE, NUM } from "./ui";

const CHOICES = 10;
const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });
const usd2 = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtSigned = (n: number) => `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(0)}`;
const usd = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 0 });

/** Equal shares in hundredths of a percent that add up to exactly 100. */
export function equalShares(n: number): number[] {
  if (n <= 0) return [];
  const base = Math.floor(10_000 / n);
  return Array.from({ length: n }, (_, i) => (i === n - 1 ? 10_000 - base * (n - 1) : base) / 100);
}

export interface CurrentPick {
  gauge: Address;
  symbol: string;
  /** Share of the amount booked on Base, 0-100. */
  pct: number;
}

/** The gauges this position is on now (leaf allocatedGauges + allocations), read in the browser. Empty if none or unreadable. */
export async function readCurrent(tokenId: bigint, symbolOf: (g: string) => string): Promise<CurrentPick[]> {
  const { wagmiConfig } = await import("@/lib/wagmi");
  const gauges = (await readContract(wagmiConfig, { address: SAERO.leafVoter, abi: saeroLeafAbi, functionName: "allocatedGauges", args: [tokenId], chainId: base.id })) as Address[];
  if (gauges.length === 0) return [];
  const amounts = (await readContracts(wagmiConfig, {
    allowFailure: false,
    contracts: gauges.map((gauge) => ({ address: SAERO.leafVoter, abi: saeroLeafAbi, functionName: "allocations" as const, args: [tokenId, gauge] as const, chainId: base.id })),
  })) as bigint[];
  const total = amounts.reduce((a, b) => a + b, 0n);
  if (total === 0n) return [];
  return gauges
    .map((gauge, i) => ({ gauge, symbol: symbolOf(gauge), pct: Number((amounts[i] * 10_000n) / total) / 100, raw: amounts[i] }))
    .filter((c) => c.raw > 0n && c.gauge !== "0x0000000000000000000000000000000000000000")
    .sort((a, b) => b.pct - a.pct)
    .map(({ gauge, symbol, pct }) => ({ gauge, symbol, pct }));
}

/**
 * Allocate one of your positions to gauges on Base. It shows the gauges ranked by what this position would earn per
 * day, lets you pick and weight them, then simulates the transaction on-chain before asking your wallet to sign.
 * Aero's allocate() replaces the whole Base distribution and starts a 47-hour wait before the next change.
 */
export function SaeroAllocate({ position, cooldownReady, onAllocated }: { position: SaeroPosition; cooldownReady: boolean; onAllocated?: () => void }) {
  const { chainId, address } = useAccount();
  const { switchChain } = useSwitchChain();
  const { writeContract, data: hash, isPending: signing, error: sendError, reset } = useWriteContract();
  const { isLoading: confirming, data: receipt } = useWaitForTransactionReceipt({ hash, chainId: base.id });
  // A mined transaction can still have reverted; only a successful receipt counts as allocated.
  const confirmed = receipt?.status === "success";
  const reverted = receipt?.status === "reverted";
  // Once it lands, the page re-reads the position so the card shows the new allocation and the new wait.
  useEffect(() => {
    if (confirmed) onAllocated?.();
  }, [confirmed]); // eslint-disable-line react-hooks/exhaustive-deps
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<YieldRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [current, setCurrent] = useState<CurrentPick[] | null>(null);
  const [compare, setCompare] = useState<{ nowUsd: number | null; unmeasured: string[]; best: Split | null } | null>(null);
  const [feesNote, setFeesNote] = useState<number | null>(null);
  const [lockHours, setLockHours] = useState(waitHours(DEFAULT_COOLDOWN_SEC));
  const [pct, setPct] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    if (!open || rows) return;
    let cancelled = false;
    Promise.all([
      fetch("/api/gauges").then((r) => (r.ok ? (r.json() as Promise<GaugeList>) : Promise.reject(new Error(String(r.status))))),
      fetch("/api/gauge-fees").then((r) => (r.ok ? (r.json() as Promise<GaugeFees>) : Promise.reject(new Error(String(r.status))))),
    ])
      .then(async ([g, f]) => {
        if (cancelled) return;
        const symbolOf = (a: string) => {
          const x = g.gauges.find((y) => y.gauge.toLowerCase() === a.toLowerCase());
          return x ? gaugeLabel(x) : `${a.slice(0, 6)}…`;
        };
        const cur = await readCurrent(position.tokenId, symbolOf).catch(() => [] as CurrentPick[]);
        if (cancelled) return;
        // The same analysis the paid API runs: your own power is taken out of each gauge's weight before comparing.
        const analysis = analysePosition({ position, current: cur, gauges: g, fees: f, cooldownSec: g.cooldownSec ?? DEFAULT_COOLDOWN_SEC, nowSec: Math.floor(Date.now() / 1000) });
        const all = analysis.ranked;
        const split = analysis.best;
        const splitGauges = new Set((split?.parts ?? []).map((p) => p.gauge.toLowerCase()));
        const top = all.slice(0, CHOICES);
        const ranked = [...top, ...all.filter((r) => splitGauges.has(r.gauge.toLowerCase()) && !top.includes(r))];
        setFeesNote(f.windowHours);
        setLockHours(analysis.cooldownHours);
        setCurrent(cur);
        if (cur.length > 0) setCompare({ nowUsd: analysis.currentUsdPerDay, unmeasured: analysis.unmeasured, best: split });
        else setCompare(null);
        // Keep your current gauges selectable even when they're outside the top picks.
        const extra = cur
          .filter((c) => !ranked.some((r) => r.gauge.toLowerCase() === c.gauge.toLowerCase()))
          .map((c) => all.find((r) => r.gauge.toLowerCase() === c.gauge.toLowerCase()) ?? { gauge: c.gauge, symbol: c.symbol, feesUsdPerDay: 0, incentivesUsdPerDay: 0, usdPerDay: 0, sharePct: 0, weight: 0, windowHours: 0 });
        setRows([...ranked, ...extra]);
        if (split) setPct(Object.fromEntries(split.parts.map((p) => [p.gauge, String(p.pct)])));
        else {
          const eq = equalShares(Math.min(3, ranked.length));
          setPct(Object.fromEntries(ranked.slice(0, eq.length).map((r, i) => [r.gauge, String(eq[i])])));
        }
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [open, rows, position]);

  const picks = useMemo(
    () =>
      Object.entries(pct)
        .map(([gauge, v]) => ({ gauge: gauge as Address, pct: Number(v) }))
        .filter((p) => p.pct > 0),
    [pct],
  );
  const total = picks.reduce((a, p) => a + p.pct, 0);
  const plan = useMemo(() => {
    try {
      return { ok: planAllocation({ tokenId: position.tokenId, parked: position.parkedRaw, onBase: position.onBaseRaw, picks }), err: null };
    } catch (e) {
      return { ok: null, err: e instanceof AllocateError ? e.message : "Check the shares." };
    }
  }, [position, picks]);
  const sums100 = Math.abs(total - 100) < 0.005;

  const toggle = (gauge: string) =>
    setPct((cur) => {
      const next = { ...cur };
      if (gauge in next) delete next[gauge];
      else next[gauge] = "10";
      return next;
    });

  const submit = async () => {
    if (!plan.ok || !address) return;
    setProblem(null);
    reset();
    if (chainId !== base.id) {
      switchChain({ chainId: base.id });
      return;
    }
    const args = allocateArgs(plan.ok, address);
    setChecking(true);
    try {
      const { wagmiConfig } = await import("@/lib/wagmi");
      // The call is typed against the generated ABI above; wagmi's per-config overloads can't resolve it for a dynamically imported config.
      await simulateContract(wagmiConfig, { address: SAERO.voter, abi: allocateAbi, functionName: "allocate", args, chainId: base.id, account: address } as unknown as Parameters<typeof simulateContract>[1]);
    } catch (e) {
      setChecking(false);
      setProblem(`Aero's contract would reject this: ${explainAllocateError(e) ?? (e as { shortMessage?: string }).shortMessage ?? "simulation failed"}. Nothing was sent.`);
      return;
    }
    setChecking(false);
    writeContract({ address: SAERO.voter, abi: allocateAbi, functionName: "allocate", args, chainId: base.id });
  };

  const usable = position.parkedRaw + position.onBaseRaw > 0n;
  if (!usable) {
    return <p className={`mt-2 ${NOTE}`}>All of this position&rsquo;s power sits on other chains; allocating there isn&rsquo;t supported yet.</p>;
  }
  if (!open) {
    return (
      <button type="button" className={`mr-2 mt-2 ${btn("primary", "sm")}`} onClick={() => setOpen(true)}>
        allocate…
      </button>
    );
  }
  return (
    <div className="mt-3 rounded-lg border border-neutral-800 px-3 py-3">
      <p className={BODY}>
        Pick up to {MAX_GAUGES} gauges (the best {CHOICES} by estimated $/day for {fmt(position.staked)} AERO are listed) and give each a share. This{" "}
        <span className="text-neutral-200">replaces your whole Base allocation</span> for this position, and you can&rsquo;t change it again for {lockHours} hours.
      </p>
      {current && current.length > 0 && (
        <p className={`mt-3 ${BODY}`}>
          Right now on Base:{" "}
          <span className="text-neutral-200">{current.map((c) => `${c.symbol} ${fmt(c.pct)}%`).join(", ")}</span>
        </p>
      )}
      {compare && compare.best && (
        <p className={`mt-1 ${BODY}`}>
          {compare.nowUsd === null ? (
            <>Where you are now can&rsquo;t be priced yet (no fee history for it). </>
          ) : (
            <>
              That earns about <span className="text-neutral-200">${usd2(compare.nowUsd)}</span> a day
              {compare.unmeasured.length > 0 && ` (not counting ${compare.unmeasured.join(", ")}, which can't be priced yet)`}.{" "}
            </>
          )}
          {compare.nowUsd !== null && compare.best.usdPerDay <= compare.nowUsd * 1.05 ? (
            <>The best split would earn about the same, so there is nothing to gain by moving.</>
          ) : (
            <>
              The best split would earn about <span className="text-emerald-400">${usd2(compare.best.usdPerDay)}</span> a day
              {compare.nowUsd !== null && compare.nowUsd > 0 && <> ({fmtSigned((compare.best.usdPerDay / compare.nowUsd - 1) * 100)}%)</>}.
            </>
          )}
        </p>
      )}
      {current && current.length === 0 && <p className={`mt-3 ${NOTE}`}>Nothing is allocated to gauges on Base yet.</p>}
      {failed && <p className="mt-2 text-sm text-rose-400">Couldn&rsquo;t load gauges. Try again in a moment.</p>}
      {!rows && !failed && <p className={`mt-3 ${NOTE}`}>Loading gauges…</p>}
      {rows && (
        <ul className="mt-3 grid grid-cols-[minmax(0,1fr)] gap-1">
          {rows.map((r) => {
            const on = r.gauge in pct;
            return (
              <li key={r.gauge} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5 text-sm text-neutral-400">
                <label className="flex min-w-0 items-center gap-2">
                  <input type="checkbox" checked={on} onChange={() => toggle(r.gauge)} aria-label={`include ${gaugeLabel(r)}`} />
                  <span className="truncate text-neutral-200">{gaugeLabel(r)}</span>
                </label>
                {r.sharePct > 0 ? <span className={`text-emerald-400 ${NUM}`}>${usd(r.usdPerDay)}/day</span> : <span className="text-neutral-500">no estimate</span>}
                {on && (
                  <label className="flex items-center gap-1">
                    <input
                      type="text"
                      inputMode="decimal"
                      value={pct[r.gauge]}
                      onChange={(e) => setPct((cur) => ({ ...cur, [r.gauge]: e.target.value }))}
                      aria-label={`share of ${gaugeLabel(r)}`}
                      className={inputCls(false, `w-20 !px-2 !py-1 text-right ${NUM}`)}
                    />
                    %
                  </label>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {rows && (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          <span className={sums100 ? "text-neutral-300" : "text-amber-500"}>Shares add up to {fmt(total)}%</span>
          {!sums100 && <span className="text-amber-500">(must be 100%)</span>}
          {plan.err && picks.length > 0 && <span className="text-amber-500">{plan.err}</span>}
        </div>
      )}
      {feesNote !== null && (
        <p className={`mt-2 ${NOTE}`}>
          Estimates use the fee pace of the last ~{Math.round(feesNote)} hours; they&rsquo;re not a promise.
        </p>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={btn("primary", "sm")}
          disabled={!plan.ok || !sums100 || !cooldownReady || signing || confirming || checking}
          onClick={submit}
        >
          {checking ? "checking…" : signing ? "confirm in wallet…" : confirming ? "confirming…" : chainId !== base.id ? "switch to Base" : "allocate"}
        </button>
        <button type="button" className={chip(false)} onClick={() => setOpen(false)}>
          close
        </button>
        {!cooldownReady && <span className="text-sm text-amber-500">Still in cooldown.</span>}
      </div>
      {problem && <p className="mt-2 text-sm text-rose-400">{problem}</p>}
      {sendError && !problem && (
        <p className="mt-2 text-sm text-rose-400">{/reject|denied/i.test(sendError.message) ? "You rejected the request in your wallet." : "The transaction failed to send."}</p>
      )}
      {hash && (
        <p className={`mt-2 ${BODY}`}>
          {confirmed ? "Allocated. " : reverted ? "The transaction was mined but failed, so nothing changed. " : "Sent. "}
          <a className={LINK} href={`https://basescan.org/tx/${hash}`} target="_blank" rel="noreferrer">
            view on Basescan ↗
          </a>
        </p>
      )}
    </div>
  );
}
