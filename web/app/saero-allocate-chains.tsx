"use client";

import { useEffect, useState } from "react";
import { useAccount, useSwitchChain, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { estimateGas, readContracts, simulateContract } from "wagmi/actions";
import { base } from "wagmi/chains";
import { encodeFunctionData, formatEther } from "viem";
import type { AllChainsSplit } from "@/lib/all-chains-read";
import { AERO_CHAINS, BASE_CHAIN } from "@/lib/aero-chains";
import { AllocateError, allocateAbi, explainAllocateError } from "@/lib/allocate";
import { planAcrossChains, withMargin, type AllocateStep } from "@/lib/allocate-multichain";
import type { CrossChainFee } from "@/lib/allocate-fee";
import { SAERO, saeroVoterAbi, type SaeroPosition } from "@/lib/saero";
import { customChainSplit, percentToHundredths } from "@/lib/custom-chain-split";
import type { ChainBook, ChainShare } from "@/lib/all-chains-split";
import { rankByUsdPerDay } from "@/lib/gauge-yield";
import { gaugeLabel, type GaugeList } from "@/lib/gauges";
import type { GaugeFees } from "@/lib/gauge-fees-read";
import { readCurrent, type CurrentPick } from "./saero-allocate";
import { horizonText } from "./all-chains-split";
import { BODY, btn, chip, input as inputCls, LINK, NOTE, NUM } from "./ui";

/** Gas limit for the send: what the simulation needs plus 30%, because a plain estimate sits right at the edge where the cross-chain dispatch runs out of gas (seen on a fork of Base). */
const GAS_HEADROOM = 130n;
const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });
const eth = (wei: bigint) => Number(formatEther(wei)).toPrecision(2);

type Loaded = { split: AllChainsSplit; quotes: Record<number, CrossChainFee>; otherRaw: bigint; current: CurrentPick[] };

/** True when a step sets gauges on Base, which the position's Base wait gates. */
const touchesBase = (s: AllocateStep) => s.args[2].some((d) => d.chainId === BigInt(BASE_CHAIN.id));

/**
 * Spread one position over gauges on several chains, from the split the "compare all chains" read finds for its power. It needs one
 * transaction when the position's power is idle or Base's share goes up, and two when Base's share goes down (the power must first go
 * back to idle on Base, which uses its wait, before it can be sent to another chain). Each step is simulated as the owner before the
 * wallet is asked, and the next step is planned from what the chain says after the previous one confirmed. Only positions with power on
 * Base and/or idle are handled; one that already has power on another chain is left to Aero's app.
 */
export function SaeroAllocateChains({ position, cooldownReady, onAllocated }: { position: SaeroPosition; cooldownReady: boolean; onAllocated?: () => void }) {
  const { chainId, address } = useAccount();
  const { switchChain } = useSwitchChain();
  const { writeContract, data: hash, isPending: signing, error: sendError, reset } = useWriteContract();
  const { isLoading: confirming, data: receipt } = useWaitForTransactionReceipt({ hash, chainId: base.id });
  const confirmed = receipt?.status === "success";
  const reverted = receipt?.status === "reverted";
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<Loaded | "failed" | null>(null);
  const [checking, setChecking] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  // "Choose myself": a percentage per chain other than Base (Base keeps the rest), and what was read for the chosen split.
  const [mode, setMode] = useState<"best" | "custom">("best");
  const [typed, setTyped] = useState<Record<number, string>>({});
  const [custom, setCustom] = useState<{ key: string; chains: ChainShare[]; usdPerDay: number; quotes: Record<number, CrossChainFee> } | { key: string; error: string } | null>(null);
  const others = AERO_CHAINS.filter((c) => c.id !== BASE_CHAIN.id && c.feeLogs);
  const otherH = others.map((c) => ({ c, h: percentToHundredths(typed[c.id] ?? "") }));
  const typedBad = otherH.some((x) => x.h === null);
  const otherSum = otherH.reduce((s, x) => s + (x.h ?? 0), 0);
  const baseH = 10_000 - otherSum;
  const customKey = `${position.votingPower}:${otherH.map((x) => `${x.c.id}=${x.h}`).join(",")}`;

  useEffect(() => {
    if (confirmed) onAllocated?.();
  }, [confirmed]); // eslint-disable-line react-hooks/exhaustive-deps

  // Read everything the plan rests on again whenever the position's own amounts change (a step landed), so the next step is built from the chain.
  useEffect(() => {
    if (!open) return;
    let live = true;
    setData(null);
    (async () => {
      const { wagmiConfig } = await import("@/lib/wagmi");
      const others = AERO_CHAINS.filter((c) => c.id !== BASE_CHAIN.id);
      const [splitRes, amounts, current] = await Promise.all([
        fetch(`/api/all-chains-split?amount=${position.votingPower}`).then((r) => (r.ok ? (r.json() as Promise<AllChainsSplit>) : Promise.reject(new Error(String(r.status))))),
        readContracts(wagmiConfig, {
          allowFailure: false,
          contracts: others.map((c) => ({ address: SAERO.voter, abi: saeroVoterAbi, functionName: "allocationChainAmounts" as const, args: [position.tokenId, BigInt(c.id)] as const, chainId: base.id })),
        }) as Promise<bigint[]>,
        readCurrent(position.tokenId, () => ""),
      ]);
      const used = splitRes.best.chains.filter((c) => c.chainId !== BASE_CHAIN.id);
      const quoteList = await Promise.all(used.map((c) => fetch(`/api/allocation-fee?chain=${c.chainId}&gauges=${c.parts.length}`).then((r) => (r.ok ? (r.json() as Promise<CrossChainFee>) : Promise.reject(new Error(String(r.status)))))));
      if (live) setData({ split: splitRes, quotes: Object.fromEntries(quoteList.map((q) => [q.chainId, q])), otherRaw: amounts.reduce((a, b) => a + b, 0n), current });
    })().catch(() => live && setData("failed"));
    return () => {
      live = false;
    };
  }, [open, position.tokenId, position.votingPower, position.parkedRaw, position.onBaseRaw]);

  // The chosen split: read each chosen chain's gauges and fees (public reads), plan the best gauges inside each share, and quote the ETH.
  useEffect(() => {
    if (!open || mode !== "custom" || typedBad || baseH < 0) return;
    let live = true;
    const t = setTimeout(async () => {
      try {
        const shares = [{ chainId: BASE_CHAIN.id, name: BASE_CHAIN.name, hundredths: baseH }, ...otherH.map((x) => ({ chainId: x.c.id, name: x.c.name, hundredths: x.h ?? 0 }))].filter((x) => x.hundredths > 0);
        const books: ChainBook[] = await Promise.all(
          shares.map(async (sh) => {
            const [g, f] = await Promise.all([
              fetch(`/api/gauges?chain=${sh.chainId}`).then((r) => (r.ok ? (r.json() as Promise<GaugeList>) : Promise.reject(new Error(String(r.status))))),
              fetch(`/api/gauge-fees?chain=${sh.chainId}`).then((r) => (r.ok ? (r.json() as Promise<GaugeFees>) : Promise.reject(new Error(String(r.status))))),
            ]);
            const amount = (position.votingPower * sh.hundredths) / 10_000;
            return {
              chainId: sh.chainId,
              name: sh.name,
              rows: rankByUsdPerDay(g.gauges, f.fees, amount).map((r) => ({ gauge: r.gauge, symbol: gaugeLabel(r), feesUsdPerDay: r.feesUsdPerDay, incentivesUsdPerDay: r.incentivesUsdPerDay, weight: r.weight, windowHours: r.windowHours })),
            };
          }),
        );
        const res = customChainSplit(shares, position.votingPower, books);
        if ("error" in res) {
          if (live) setCustom({ key: customKey, error: res.error });
          return;
        }
        const used = res.chains.filter((c) => c.chainId !== BASE_CHAIN.id);
        const quoteList = await Promise.all(used.map((c) => fetch(`/api/allocation-fee?chain=${c.chainId}&gauges=${c.parts.length}`).then((r) => (r.ok ? (r.json() as Promise<CrossChainFee>) : Promise.reject(new Error(String(r.status)))))));
        if (live) setCustom({ key: customKey, chains: res.chains, usdPerDay: res.usdPerDay, quotes: Object.fromEntries(quoteList.map((q) => [q.chainId, q])) });
      } catch {
        if (live) setCustom({ key: customKey, error: "Could not read those chains just now. Try again in a moment." });
      }
    }, 600);
    return () => {
      live = false;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode, customKey]);

  // What is being proposed: the best split from the comparison, or the one chosen by hand (once its reads for these exact shares are in).
  const customReady = mode === "custom" && custom && custom.key === customKey ? custom : null;
  const proposal: { chains: ChainShare[]; usdPerDay: number; feeText: string; quotes: Record<number, CrossChainFee>; days?: number } | null =
    !data || data === "failed"
      ? null
      : mode === "best"
        ? { chains: data.split.best.chains, usdPerDay: data.split.best.usdPerDay, feeText: `after about $${fmt(data.split.best.feeUsd)} in one-off ETH fees`, quotes: data.quotes, days: data.split.days }
        : customReady && "chains" in customReady
          ? { chains: customReady.chains, usdPerDay: customReady.usdPerDay, feeText: "before the one-off ETH fees below", quotes: customReady.quotes }
          : null;
  const plan = ((): { steps: AllocateStep[] } | { error: string } | null => {
    if (!data || data === "failed" || !address || !proposal) return null;
    if (mode === "best" && proposal.chains.length === 1 && proposal.chains[0].chainId === BASE_CHAIN.id) return { error: "base" };
    try {
      const quote = (id: number) => proposal.quotes[id];
      return {
        steps: planAcrossChains({
          tokenId: position.tokenId,
          parked: position.parkedRaw,
          onBase: position.onBaseRaw,
          currentBase: data.current,
          refundRecipient: address,
          targets: proposal.chains.map((c) => ({ chainId: c.chainId, picks: c.parts.map((p) => ({ gauge: p.gauge, bps: Math.round(p.pct * 100) })) })),
          fees: {
            chainStepWei: (id) => withMargin(BigInt(quote(id).chainStep)),
            gaugeStepWei: (id) => withMargin(BigInt(quote(id).gaugeStep)),
          },
        }),
      };
    } catch (e) {
      return { error: e instanceof AllocateError ? e.message : "Could not plan this split." };
    }
  })();

  const send = async (step: AllocateStep) => {
    if (!address) return;
    setProblem(null);
    reset();
    if (chainId !== base.id) {
      switchChain({ chainId: base.id });
      return;
    }
    setChecking(true);
    try {
      const { wagmiConfig } = await import("@/lib/wagmi");
      const call = { address: SAERO.voter, abi: allocateAbi, functionName: "allocate", args: step.args, value: step.valueWei, chainId: base.id, account: address } as unknown as Parameters<typeof simulateContract>[1];
      await simulateContract(wagmiConfig, call);
      const callData = encodeFunctionData({ abi: allocateAbi, functionName: "allocate", args: step.args });
      const gas = await estimateGas(wagmiConfig, { to: SAERO.voter, data: callData, value: step.valueWei, account: address, chainId: base.id } as unknown as Parameters<typeof estimateGas>[1]);
      setChecking(false);
      writeContract({ address: SAERO.voter, abi: allocateAbi, functionName: "allocate", args: step.args, value: step.valueWei, chainId: base.id, gas: (gas * GAS_HEADROOM) / 100n } as unknown as Parameters<typeof writeContract>[0]);
    } catch (e) {
      setChecking(false);
      setProblem(`Aero's contract would reject this: ${explainAllocateError(e) ?? (e as { shortMessage?: string }).shortMessage ?? "simulation failed"}. Nothing was sent.`);
    }
  };

  if (position.parkedRaw + position.onBaseRaw <= 0n) return null;
  if (!open) {
    return (
      <button type="button" className={`mr-2 mt-2 ${btn("secondary", "sm")}`} onClick={() => setOpen(true)}>
        allocate across chains…
      </button>
    );
  }

  const steps = plan && "steps" in plan ? plan.steps : [];
  const next = steps[0];
  const totalWei = steps.reduce((s, x) => s + x.valueWei, 0n);
  const ready = data && data !== "failed" && data.otherRaw === 0n;
  const customError = mode === "custom" ? (typedBad ? "Shares are percentages from 0 to 100, with at most two decimals." : baseH < 0 ? "The shares add up to more than 100%." : custom && custom.key === customKey && "error" in custom ? custom.error : null) : null;
  return (
    <div className="mt-3 rounded-lg border border-neutral-800 px-3 py-3">
      <div className="flex items-start justify-between gap-3">
        <p className={BODY}>
          Spread this position over several chains. Power sent to another chain travels by Aero&rsquo;s cross-chain messages, so it costs a little ETH on Base and arrives in a few minutes. Each chain
          has its own wait after you set its gauges.
        </p>
        <button type="button" className={btn("secondary", "sm")} onClick={() => setOpen(false)}>
          close
        </button>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" className={chip(mode === "best")} aria-pressed={mode === "best"} onClick={() => setMode("best")}>
          best split
        </button>
        <button type="button" className={chip(mode === "custom")} aria-pressed={mode === "custom"} onClick={() => setMode("custom")}>
          choose the chains myself
        </button>
      </div>
      {mode === "custom" && (
        <div className="mt-3">
          <p className={NOTE}>Type how much of the position goes to each chain, in percent. Base keeps the rest. On each chain the gauges are the best split for its share.</p>
          <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-4">
            {others.map((c) => (
              <label key={c.id} className="flex items-center gap-2 text-sm text-neutral-300">
                <span className="w-24 shrink-0 truncate">{c.name}</span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={typed[c.id] ?? ""}
                  onChange={(e) => setTyped((t) => ({ ...t, [c.id]: e.target.value }))}
                  placeholder="0"
                  aria-label={`percent of the position on ${c.name}`}
                  className={inputCls(percentToHundredths(typed[c.id] ?? "") === null, `w-16 ${NUM}`)}
                />
                <span className={NOTE}>%</span>
              </label>
            ))}
          </div>
          <p className={`mt-2 text-sm text-neutral-300`}>
            Base keeps <span className={`text-neutral-100 ${NUM}`}>{baseH >= 0 ? fmt(baseH / 100) : "0"}%</span>.
          </p>
        </div>
      )}
      {data === null && <p className={`mt-2 ${NOTE}`}>Reading the chains and this position…</p>}
      {data === "failed" && <p className="mt-2 text-sm text-rose-400">Could not read the chains just now. Try again in a moment.</p>}
      {data && data !== "failed" && data.otherRaw > 0n && (
        <p className="mt-2 text-sm text-amber-500">
          This position already has power on other chains. Moving that from here isn&rsquo;t built, so manage it in Aero&rsquo;s app.
        </p>
      )}
      {customError && ready && <p className="mt-2 text-sm text-amber-500">{customError}</p>}
      {mode === "custom" && ready && !customError && !proposal && <p className={`mt-2 ${NOTE}`}>Reading the chains you picked…</p>}
      {ready && plan && "error" in plan && (
        <p className={`mt-2 ${BODY}`}>
          {plan.error === "base"
            ? `Staying on Base is the best use of this position over ${horizonText(data.split.days)}: the ETH fees to reach other chains would cost more than they add. Use “allocate…” instead, or choose the chains yourself.`
            : plan.error}
        </p>
      )}
      {ready && proposal && next && (
        <>
          <ul className={`mt-3 grid grid-cols-[minmax(0,1fr)] gap-1 text-sm text-neutral-300`}>
            {proposal.chains.map((c) => (
              <li key={c.chainId}>
                <span className="text-neutral-100">{c.name}</span> {c.pct}%: {c.parts.map((p) => `${p.symbol} ${p.pct}%`).join(" · ")}
              </li>
            ))}
          </ul>
          <p className={`mt-2 ${NOTE}`}>
            About <span className={`text-neutral-200 ${NUM}`}>${fmt(proposal.usdPerDay)}</span> a day at today&rsquo;s pace, {proposal.feeText}. {steps.length === 1 ? "One transaction" : `${steps.length} transactions, one after the other`}
            {totalWei > 0n ? `, with up to ${eth(totalWei)} ETH attached on Base (what isn't needed is refunded to your wallet)` : ""}.
          </p>
          <p className={`mt-2 text-sm text-neutral-200`}>
            Next{steps.length > 1 ? ` (1 of ${steps.length} left)` : ""}: {next.label}.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button type="button" className={btn("primary", "sm")} disabled={signing || confirming || checking || (touchesBase(next) && !cooldownReady)} onClick={() => send(next)}>
              {checking ? "checking…" : signing ? "confirm in wallet…" : confirming ? "confirming…" : chainId !== base.id ? "switch to Base" : "send this step"}
            </button>
            {touchesBase(next) && !cooldownReady && <span className="text-sm text-amber-500">Still in cooldown.</span>}
          </div>
          <p className={`mt-2 ${NOTE}`}>
            Power on another chain shows as idle there until Aero&rsquo;s message sets its gauges, usually a few minutes. Read-only checks are made as your wallet first; nothing is sent if they fail.
          </p>
        </>
      )}
      {ready && proposal && plan && "steps" in plan && steps.length === 0 && <p className={`mt-2 ${BODY}`}>This position already matches that split.</p>}
      {problem && <p className="mt-2 text-sm text-rose-400">{problem}</p>}
      {sendError && !problem && <p className="mt-2 text-sm text-rose-400">{/reject|denied/i.test(sendError.message) ? "You rejected the request in your wallet." : "The transaction failed to send."}</p>}
      {hash && (
        <p className={`mt-2 ${BODY}`}>
          {confirmed ? "Confirmed. " : reverted ? "The transaction was mined but failed, so nothing changed. " : "Sent. "}
          <a className={LINK} href={`https://basescan.org/tx/${hash}`} target="_blank" rel="noreferrer">
            view on Basescan ↗
          </a>
        </p>
      )}
    </div>
  );
}
