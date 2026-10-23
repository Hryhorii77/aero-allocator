"use client";

import { useEffect, useMemo, useState } from "react";
import { useAccount, useSwitchChain, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { simulateContract } from "wagmi/actions";
import { base } from "wagmi/chains";
import type { Address } from "viem";
import type { GaugeList } from "@/lib/gauges";
import type { GaugeFees } from "@/lib/gauge-fees-read";
import { rankByUsdPerDay, type YieldRow } from "@/lib/gauge-yield";
import { AllocateError, allocateAbi, allocateArgs, MAX_GAUGES, planAllocation } from "@/lib/allocate";
import { SAERO, type SaeroPosition } from "@/lib/saero";
import { btn, chip, LINK } from "./ui";

const CHOICES = 10;
const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });
const usd = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 0 });

/** Equal shares in hundredths of a percent that add up to exactly 100. */
export function equalShares(n: number): number[] {
  if (n <= 0) return [];
  const base = Math.floor(10_000 / n);
  return Array.from({ length: n }, (_, i) => (i === n - 1 ? 10_000 - base * (n - 1) : base) / 100);
}

/**
 * Allocate one of your positions to gauges on Base. It shows the gauges ranked by what this position would earn per
 * day, lets you pick and weight them, then simulates the transaction on-chain before asking your wallet to sign.
 * Aero's allocate() replaces the whole Base distribution and starts a 47-hour wait before the next change.
 */
export function SaeroAllocate({ position, cooldownReady }: { position: SaeroPosition; cooldownReady: boolean }) {
  const { chainId, address } = useAccount();
  const { switchChain } = useSwitchChain();
  const { writeContract, data: hash, isPending: signing, error: sendError, reset } = useWriteContract();
  const { isLoading: confirming, isSuccess: confirmed } = useWaitForTransactionReceipt({ hash, chainId: base.id });
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<YieldRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [feesNote, setFeesNote] = useState<number | null>(null);
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
      .then(([g, f]) => {
        if (cancelled) return;
        const ranked = rankByUsdPerDay(g.gauges, f.fees, position.staked).slice(0, CHOICES);
        setRows(ranked);
        setFeesNote(f.windowHours);
        const top = equalShares(Math.min(3, ranked.length));
        setPct(Object.fromEntries(ranked.slice(0, top.length).map((r, i) => [r.gauge, String(top[i])])));
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [open, rows, position.staked]);

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
      setProblem(`Aero's contract would reject this: ${(e as { shortMessage?: string }).shortMessage ?? "simulation failed"}. Nothing was sent.`);
      return;
    }
    setChecking(false);
    writeContract({ address: SAERO.voter, abi: allocateAbi, functionName: "allocate", args, chainId: base.id });
  };

  const usable = position.parkedRaw + position.onBaseRaw > 0n;
  if (!usable) {
    return <p className="mt-2 text-xs text-neutral-500">All of this position&rsquo;s power sits on other chains; allocating there isn&rsquo;t supported yet.</p>;
  }
  if (!open) {
    return (
      <button type="button" className={`mt-2 ${btn("primary", "sm")}`} onClick={() => setOpen(true)}>
        allocate…
      </button>
    );
  }
  return (
    <div className="mt-2 rounded-md border border-neutral-800 px-2 py-2">
      <p className="text-xs text-neutral-400">
        Pick up to {MAX_GAUGES} gauges (the best {CHOICES} by estimated $/day for {fmt(position.staked)} AERO are listed) and give each a share. This{" "}
        <span className="text-neutral-200">replaces your whole Base allocation</span> for this position, and you can&rsquo;t change it again for 47 hours.
      </p>
      {failed && <p className="mt-2 text-xs text-rose-400">Couldn&rsquo;t load gauges. Try again in a moment.</p>}
      {!rows && !failed && <p className="mt-2 text-xs text-neutral-500">Loading gauges…</p>}
      {rows && (
        <ul className="mt-2 grid grid-cols-[minmax(0,1fr)] gap-1">
          {rows.map((r) => {
            const on = r.gauge in pct;
            return (
              <li key={r.gauge} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-neutral-400">
                <label className="flex min-w-0 items-center gap-2">
                  <input type="checkbox" checked={on} onChange={() => toggle(r.gauge)} aria-label={`include ${r.symbol}`} />
                  <span className="truncate text-neutral-200">{r.symbol}</span>
                </label>
                <span className="text-emerald-400">${usd(r.usdPerDay)}/day</span>
                {on && (
                  <label className="flex items-center gap-1">
                    <input
                      type="text"
                      inputMode="decimal"
                      value={pct[r.gauge]}
                      onChange={(e) => setPct((cur) => ({ ...cur, [r.gauge]: e.target.value }))}
                      aria-label={`share of ${r.symbol}`}
                      className="w-16 rounded border border-neutral-700 bg-neutral-950 px-1 py-0.5 text-right font-mono text-xs text-neutral-200 focus:border-sky-600 focus:outline-none"
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
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
          <span className={sums100 ? "text-neutral-300" : "text-amber-500"}>Shares add up to {fmt(total)}%</span>
          {!sums100 && <span className="text-amber-500">(must be 100%)</span>}
          {plan.err && picks.length > 0 && <span className="text-amber-500">{plan.err}</span>}
        </div>
      )}
      {feesNote !== null && (
        <p className="mt-1 text-[11px] text-neutral-500">
          Estimates use the fee pace of the last ~{Math.round(feesNote)} hours; they&rsquo;re not a promise.
        </p>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-2">
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
        {!cooldownReady && <span className="text-xs text-amber-500">Still in cooldown.</span>}
      </div>
      {problem && <p className="mt-2 text-xs text-rose-400">{problem}</p>}
      {sendError && !problem && (
        <p className="mt-2 text-xs text-rose-400">{/reject|denied/i.test(sendError.message) ? "You rejected the request in your wallet." : "The transaction failed to send."}</p>
      )}
      {hash && (
        <p className="mt-2 text-xs text-neutral-400">
          {confirmed ? "Allocated. " : "Sent. "}
          <a className={LINK} href={`https://basescan.org/tx/${hash}`} target="_blank" rel="noreferrer">
            view on Basescan ↗
          </a>
        </p>
      )}
    </div>
  );
}
