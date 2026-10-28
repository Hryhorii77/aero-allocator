"use client";

import { useEffect, useRef, useState } from "react";
import { useAccount, useSwitchChain, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { estimateGas, readContracts, simulateContract } from "wagmi/actions";
import { base } from "wagmi/chains";
import { encodeFunctionData, formatEther } from "viem";
import type { AllChainsSplit } from "@/lib/all-chains-read";
import type { ChainBook, ChainShare } from "@/lib/all-chains-split";
import { AERO_CHAINS, BASE_CHAIN } from "@/lib/aero-chains";
import { AllocateError, allocateAbi, explainAllocateError } from "@/lib/allocate";
import { planAcrossChains, withMargin, type AllocateStep, type CurrentChain } from "@/lib/allocate-multichain";
import { customChainSplit, parseManualPicks, percentToHundredths, type ManualPicks } from "@/lib/custom-chain-split";
import type { GaugeFees } from "@/lib/gauge-fees-read";
import { rankByUsdPerDay } from "@/lib/gauge-yield";
import { gaugeLabel, type GaugeList } from "@/lib/gauges";
import { readLeafChain, type LeafChainState } from "@/lib/leaf-read";
import { pendingLeftMs, setPending } from "@/lib/pending-lock";
import { cooldownState, formatDuration, SAERO, saeroVoterAbi, type SaeroPosition } from "@/lib/saero";
import { horizonText } from "./all-chains-split";
import { equalShares, readCurrent, type CurrentPick } from "./saero-allocate";
import { SaeroManageChains } from "./saero-manage-chains";
import { BODY, btn, chip, input as inputCls, LINK, NOTE, NUM } from "./ui";

/** Gas limit for the send: what the simulation needs plus 30%, because a plain estimate sits right at the edge where the cross-chain dispatch runs out of gas (seen on a fork of Base). */
const GAS_HEADROOM = 130n;
const E18 = 10n ** 18n;
const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });
const eth = (wei: bigint) => Number(formatEther(wei)).toPrecision(2);
const power = (raw: bigint) => Number(raw / (E18 / 100n)) / 100;

type Loaded = { split: AllChainsSplit; otherRaw: bigint; byChain: Record<number, bigint>; current: CurrentPick[] };
/** A chain's cross-chain cost as a straight line in the number of gauges, from `/api/allocation-fee?model=1`. */
type Model = { chainStep: bigint; gaugeBase: bigint; perGauge: bigint; returnCost: bigint };
type RankedRow = { gauge: string; symbol: string; usd: number };
type CustomState = { key: string; chains: ChainShare[]; usdPerDay: number } | { key: string; error: string } | null;

/**
 * Spread one position over gauges on several chains, or move it between them, starting from where it is now on EVERY chain. The plan is
 * one or two transactions: a return (a chain whose share goes down keeps the gauges it still wants and returns the rest to idle) and a send
 * (idle power goes out to the chains whose share goes up, and their gauges are set). Power returned from a chain other than Base becomes
 * idle on Base only when Aero's message arrives, minutes later, so the send waits for that; it is planned again from what the chains say
 * after each step. Each step is simulated as the owner before the wallet is asked.
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
  // The chains a just-sent change is for, so their lock is set once the transaction has a hash (not when the wallet is merely asked).
  const sentFor = useRef<number[] | null>(null);
  // Each other chain's own state of this position (null = could not be read), read lazily for the chains a plan touches.
  const [leaves, setLeaves] = useState<Record<number, LeafChainState | null>>({});
  const [models, setModels] = useState<Record<number, Model | null>>({});
  // "Choose myself": a percentage per chain other than Base (Base keeps the rest), optionally the gauges inside a chain, and what was read for them.
  const [mode, setMode] = useState<"best" | "custom">("best");
  const [typed, setTyped] = useState<Record<number, string>>({});
  const [typedGauges, setTypedGauges] = useState<Record<number, Record<string, string>>>({});
  const [custom, setCustom] = useState<CustomState>(null);
  const [rowsByChain, setRowsByChain] = useState<Record<number, RankedRow[]>>({});
  const [nowSec, setNowSec] = useState(() => Math.floor(Date.now() / 1000));

  const others = AERO_CHAINS.filter((c) => c.id !== BASE_CHAIN.id && c.feeLogs);
  const otherH = others.map((c) => ({ c, h: percentToHundredths(typed[c.id] ?? "") }));
  const typedBad = otherH.some((x) => x.h === null);
  const otherSum = otherH.reduce((s, x) => s + (x.h ?? 0), 0);
  const baseH = 10_000 - otherSum;
  const shareOf = (id: number) => (id === BASE_CHAIN.id ? baseH : (otherH.find((x) => x.c.id === id)?.h ?? 0));
  const customChains = [BASE_CHAIN, ...others];
  // The gauges typed for each chain that has a share: a parse error stops the plan with its own message.
  const gaugeParse = customChains.map((c) => ({ c, parsed: shareOf(c.id) > 0 ? parseManualPicks(typedGauges[c.id] ?? {}) : null }));
  const gaugeError = gaugeParse.map((x) => (x.parsed && "error" in x.parsed ? `${x.c.name}: ${x.parsed.error}` : null)).find((e) => e) ?? null;
  const manual: ManualPicks = Object.fromEntries(gaugeParse.flatMap((x) => (x.parsed && "picks" in x.parsed ? [[x.c.id, x.parsed.picks]] : [])));
  const hasOtherPower = !!data && data !== "failed" && data.otherRaw > 0n;
  const customKey = `${position.votingPower}:${otherH.map((x) => `${x.c.id}=${x.h}`).join(",")}:${JSON.stringify(gaugeParse.map((x) => [x.c.id, typedGauges[x.c.id] ?? {}]))}`;

  useEffect(() => {
    const t = setInterval(() => setNowSec(Math.floor(Date.now() / 1000)), 30_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (hash && sentFor.current !== null) {
      for (const id of sentFor.current) setPending(position.tokenId, id);
      sentFor.current = null;
    }
  }, [hash]); // eslint-disable-line react-hooks/exhaustive-deps

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
      const [splitRes, amounts, current] = await Promise.all([
        fetch(`/api/all-chains-split?amount=${position.votingPower}`).then((r) => (r.ok ? (r.json() as Promise<AllChainsSplit>) : Promise.reject(new Error(String(r.status))))),
        readContracts(wagmiConfig, {
          allowFailure: false,
          contracts: others.map((c) => ({ address: SAERO.voter, abi: saeroVoterAbi, functionName: "allocationChainAmounts" as const, args: [position.tokenId, BigInt(c.id)] as const, chainId: base.id })),
        }) as Promise<bigint[]>,
        readCurrent(position.tokenId, () => ""),
      ]);
      const byChain = Object.fromEntries(others.map((c, i) => [c.id, amounts[i] ?? 0n]));
      const withPower = others.filter((c) => (byChain[c.id] ?? 0n) > 0n);
      const read = await Promise.all(withPower.map((c) => readLeafChain(c.id, position.tokenId).catch(() => null)));
      if (live) {
        setLeaves(Object.fromEntries(withPower.map((c, i) => [c.id, read[i]])));
        setData({ split: splitRes, otherRaw: amounts.reduce((a, b) => a + (b ?? 0n), 0n), byChain, current });
      }
    })().catch(() => live && setData("failed"));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, position.tokenId, position.votingPower, position.parkedRaw, position.onBaseRaw]);

  // The chosen split: read each chosen chain's gauges and fees (public reads), plan the best gauges inside each share (or the ones typed), and rank them for the picker.
  const needsOtherShare = !hasOtherPower;
  useEffect(() => {
    if (!open || mode !== "custom" || typedBad || baseH < 0 || (needsOtherShare && otherSum === 0)) return;
    let live = true;
    const t = setTimeout(async () => {
      try {
        const shares = [{ chainId: BASE_CHAIN.id, name: BASE_CHAIN.name, hundredths: baseH }, ...otherH.map((x) => ({ chainId: x.c.id, name: x.c.name, hundredths: x.h ?? 0 }))].filter((x) => x.hundredths > 0);
        const ranked: Record<number, RankedRow[]> = {};
        const books: ChainBook[] = await Promise.all(
          shares.map(async (sh) => {
            const [g, f] = await Promise.all([
              fetch(`/api/gauges?chain=${sh.chainId}`).then((r) => (r.ok ? (r.json() as Promise<GaugeList>) : Promise.reject(new Error(String(r.status))))),
              fetch(`/api/gauge-fees?chain=${sh.chainId}`).then((r) => (r.ok ? (r.json() as Promise<GaugeFees>) : Promise.reject(new Error(String(r.status))))),
            ]);
            const amount = (position.votingPower * sh.hundredths) / 10_000;
            const rows = rankByUsdPerDay(g.gauges, f.fees, amount);
            ranked[sh.chainId] = rows.slice(0, 10).map((r) => ({ gauge: r.gauge, symbol: gaugeLabel(r), usd: r.usdPerDay }));
            return {
              chainId: sh.chainId,
              name: sh.name,
              rows: rows.map((r) => ({ gauge: r.gauge, symbol: gaugeLabel(r), feesUsdPerDay: r.feesUsdPerDay, incentivesUsdPerDay: r.incentivesUsdPerDay, weight: r.weight, windowHours: r.windowHours })),
            };
          }),
        );
        if (live) setRowsByChain(ranked);
        const res = customChainSplit(shares, position.votingPower, books, manual);
        if (live) setCustom("error" in res ? { key: customKey, error: res.error } : { key: customKey, chains: res.chains, usdPerDay: res.usdPerDay });
      } catch {
        if (live) setCustom({ key: customKey, error: "Could not read those chains just now. Try again in a moment." });
      }
    }, 600);
    return () => {
      live = false;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode, customKey, needsOtherShare]);

  // What is being proposed: the best split from the comparison, or the one chosen by hand (once its reads for these exact shares are in).
  const customReady = mode === "custom" && custom && custom.key === customKey ? custom : null;
  const proposal: { chains: ChainShare[]; usdPerDay: number; feeText: string } | null =
    !data || data === "failed"
      ? null
      : mode === "best"
        ? { chains: data.split.best.chains, usdPerDay: data.split.best.usdPerDay, feeText: `after about $${fmt(data.split.best.feeUsd)} in one-off ETH fees` }
        : (!needsOtherShare || otherSum > 0) && !gaugeError && customReady && "chains" in customReady
          ? { chains: customReady.chains, usdPerDay: customReady.usdPerDay, feeText: "before the one-off ETH fees" }
          : null;

  // Every chain the plan touches or the position sits on needs its cost model; read once each.
  const involvedSet = new Set<number>(proposal?.chains.map((c) => c.chainId) ?? []);
  if (data && data !== "failed") for (const [id, a] of Object.entries(data.byChain)) if (a > 0n) involvedSet.add(Number(id));
  const involved = [...involvedSet].filter((id) => id !== BASE_CHAIN.id).sort((a, b) => a - b);
  const involvedKey = involved.join(",");
  useEffect(() => {
    const need = involvedKey === "" ? [] : involvedKey.split(",").map(Number).filter((id) => !(id in models));
    if (need.length === 0) return;
    let live = true;
    Promise.all(
      need.map((id) =>
        fetch(`/api/allocation-fee?chain=${id}&model=1`)
          .then((r) => (r.ok ? (r.json() as Promise<{ chainStep: string; gaugeBase: string; perGauge: string; returnCost: string }>) : null))
          .then((m): Model | null => (m ? { chainStep: BigInt(m.chainStep), gaugeBase: BigInt(m.gaugeBase), perGauge: BigInt(m.perGauge), returnCost: BigInt(m.returnCost) } : null))
          .catch(() => null),
      ),
    ).then((list) => live && setModels((prev) => ({ ...prev, ...Object.fromEntries(need.map((id, i) => [id, list[i]])) })));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [involvedKey]);

  const modelsReady = involved.every((id) => models[id] !== undefined);
  const modelMissing = involved.find((id) => models[id] === null);

  const plan = ((): { steps: AllocateStep[] } | { error: string } | null => {
    if (!data || data === "failed" || !address || !proposal || !modelsReady) return null;
    if (modelMissing !== undefined) return { error: `Could not read what ${AERO_CHAINS.find((c) => c.id === modelMissing)?.name ?? "that chain"} costs to reach just now. Try again in a moment.` };
    if (mode === "best" && !hasOtherPower && proposal.chains.length === 1 && proposal.chains[0].chainId === BASE_CHAIN.id) return { error: "base" };
    try {
      const m = (id: number) => models[id]!;
      const currentOthers: Record<number, CurrentChain> = Object.fromEntries(
        Object.entries(data.byChain)
          .filter(([, a]) => a > 0n)
          .map(([id, amount]) => {
            const leaf = leaves[Number(id)];
            return [Number(id), { amount, gauges: leaf && leaf.total > 0n ? leaf.gauges.map((x) => ({ gauge: x.gauge, pct: Number((x.amount * 10_000n) / leaf.total) / 100 })) : [] }];
          }),
      );
      return {
        steps: planAcrossChains({
          tokenId: position.tokenId,
          parked: position.parkedRaw,
          onBase: position.onBaseRaw,
          currentBase: data.current,
          others: currentOthers,
          refundRecipient: address,
          targets: proposal.chains.map((c) => ({ chainId: c.chainId, picks: c.parts.map((p) => ({ gauge: p.gauge, bps: Math.round(p.pct * 100) })) })),
          fees: {
            chainStepWei: (id) => withMargin(m(id).chainStep),
            gaugeStepWei: (id, n) => withMargin(m(id).gaugeBase + m(id).perGauge * BigInt(n)),
            returnCostWei: (id) => m(id).returnCost,
          },
        }),
      };
    } catch (e) {
      return { error: e instanceof AllocateError ? e.message : "Could not plan this split." };
    }
  })();
  const steps = plan && "steps" in plan ? plan.steps : [];
  const next = steps[0];

  // The chains the next step touches need their own state (their wait): read the ones not read yet.
  const nextKey = next ? next.chains.filter((c) => c !== BASE_CHAIN.id).sort((a, b) => a - b).join(",") : "";
  useEffect(() => {
    const need = nextKey === "" ? [] : nextKey.split(",").map(Number).filter((id) => !(id in leaves));
    if (need.length === 0) return;
    let live = true;
    Promise.all(need.map((id) => readLeafChain(id, position.tokenId).catch(() => null))).then((list) => live && setLeaves((prev) => ({ ...prev, ...Object.fromEntries(need.map((id, i) => [id, list[i]])) })));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nextKey]);

  /** Why the next step can't be sent yet, or null when it can. */
  const waitReason = ((): string | null => {
    if (!next || !data || data === "failed") return null;
    if (position.parkedRaw < next.needsIdle) {
      return `Waiting for Aero's message to bring ${fmt(power(next.needsIdle))} power back to idle on Base (${fmt(power(position.parkedRaw))} is idle now). This usually takes a few minutes; reopen this panel to check again.`;
    }
    for (const id of next.chains) {
      const name = AERO_CHAINS.find((c) => c.id === id)?.name ?? `chain ${id}`;
      if (id === BASE_CHAIN.id) {
        if (!cooldownReady) return "Base is still in its wait.";
        continue;
      }
      const leaf = leaves[id];
      if (leaf === undefined) return `Reading ${name}…`;
      if (leaf === null) return `Could not read ${name}'s own node just now.`;
      // A message still on its way comes first: once a chain has applied a change its own wait starts, which would read like a 47 hour block.
      if ((data.byChain[id] ?? 0n) > 0n && leaf.total + leaf.idle !== (data.byChain[id] ?? 0n)) return `A change on ${name} is still on its way. Try again when Aero's message has arrived (a few minutes).`;
      if (pendingLeftMs(position.tokenId, id, nowSec * 1000) > 0) return `You sent a change for ${name} a few minutes ago; wait for it to arrive.`;
      const wait = cooldownState(leaf.lastAllocatedSec, leaf.cooldownSec, nowSec);
      if (!wait.ready) return `${name}'s wait ends in ${formatDuration(wait.secondsLeft)}.`;
    }
    return null;
  })();

  const send = async (step: AllocateStep) => {
    if (!address) return;
    setProblem(null);
    reset();
    sentFor.current = null;
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
      sentFor.current = step.chains.filter((c) => c !== BASE_CHAIN.id);
      writeContract({ address: SAERO.voter, abi: allocateAbi, functionName: "allocate", args: step.args, value: step.valueWei, chainId: base.id, gas: (gas * GAS_HEADROOM) / 100n } as unknown as Parameters<typeof writeContract>[0]);
    } catch (e) {
      setChecking(false);
      setProblem(`Aero's contract would reject this: ${explainAllocateError(e) ?? (e as { shortMessage?: string }).shortMessage ?? "simulation failed"}. Nothing was sent.`);
    }
  };

  if (position.parkedRaw + position.onBaseRaw + (data && data !== "failed" ? data.otherRaw : 0n) <= 0n && data !== null) return null;
  if (!open) {
    return (
      <button type="button" className={`mr-2 mt-2 ${btn("secondary", "sm")}`} onClick={() => setOpen(true)}>
        allocate across chains…
      </button>
    );
  }

  const ready = !!data && data !== "failed";
  const totalWei = steps.reduce((s, x) => s + x.valueWei, 0n);
  const customError = mode === "custom" ? (typedBad ? "Shares are percentages from 0 to 100, with at most two decimals." : baseH < 0 ? "The shares add up to more than 100%." : (gaugeError ?? (custom && custom.key === customKey && "error" in custom ? custom.error : null))) : null;
  const toggleGauge = (chain: number, gauge: string) =>
    setTypedGauges((t) => {
      const cur = { ...(t[chain] ?? {}) };
      if (gauge in cur) delete cur[gauge];
      else cur[gauge] = "0";
      const keys = Object.keys(cur);
      const even = equalShares(keys.length);
      keys.forEach((k, i) => (cur[k] = String(even[i])));
      return { ...t, [chain]: cur };
    });
  return (
    <div className="mt-3 rounded-lg border border-neutral-800 px-3 py-3">
      <div className="flex items-start justify-between gap-3">
        <p className={BODY}>
          Spread this position over several chains, or move it between them. Power sent to another chain travels by Aero&rsquo;s cross-chain messages, so it costs a little ETH on Base and arrives in a few
          minutes. Power you take back from another chain also arrives in a few minutes, and only then can it be sent on. Each chain has its own wait after you set its gauges.
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
      {mode === "custom" && ready && (
        <div className="mt-3">
          <p className={NOTE}>
            Type how much of the position goes to each chain, in percent. Base keeps the rest. On each chain the gauges are the best split for its share, or the ones you pick under it.
            {hasOtherPower ? " Lowering a chain's percentage returns the difference to idle first." : ""}
          </p>
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
          {customChains
            .filter((c) => shareOf(c.id) > 0 && (rowsByChain[c.id]?.length ?? 0) > 0)
            .map((c) => (
              <details key={c.id} className="mt-2">
                <summary className={`cursor-pointer select-none ${NOTE}`}>
                  Pick the gauges on {c.name} myself{Object.keys(typedGauges[c.id] ?? {}).length > 0 ? ` (${Object.keys(typedGauges[c.id]).length} picked)` : " (best split now)"}
                </summary>
                <ul className="mt-1 grid grid-cols-[minmax(0,1fr)] gap-1">
                  {rowsByChain[c.id].map((r) => {
                    const picked = r.gauge in (typedGauges[c.id] ?? {});
                    return (
                      <li key={r.gauge} className="flex flex-wrap items-center gap-2 text-sm text-neutral-300">
                        <label className="flex min-w-0 items-center gap-2">
                          <input type="checkbox" checked={picked} onChange={() => toggleGauge(c.id, r.gauge)} aria-label={`use ${r.symbol} on ${c.name}`} />
                          <span className="truncate">{r.symbol}</span>
                        </label>
                        <span className={NOTE}>about ${fmt(r.usd)} a day if all of this chain&rsquo;s share went here</span>
                        {picked && (
                          <input
                            type="text"
                            inputMode="decimal"
                            value={typedGauges[c.id][r.gauge]}
                            onChange={(e) => setTypedGauges((t) => ({ ...t, [c.id]: { ...(t[c.id] ?? {}), [r.gauge]: e.target.value } }))}
                            aria-label={`percent of ${c.name} on ${r.symbol}`}
                            className={inputCls(percentToHundredths(typedGauges[c.id][r.gauge]) === null, `w-16 ${NUM}`)}
                          />
                        )}
                        {picked && <span className={NOTE}>%</span>}
                      </li>
                    );
                  })}
                </ul>
              </details>
            ))}
        </div>
      )}
      {data === null && <p className={`mt-2 ${NOTE}`}>Reading the chains and this position…</p>}
      {data === "failed" && <p className="mt-2 text-sm text-rose-400">Could not read the chains just now. Try again in a moment.</p>}
      {mode === "custom" && ready && needsOtherShare && otherSum === 0 && !typedBad && (
        <p className={`mt-2 ${BODY}`}>Type a percentage for at least one chain to see a plan. With everything on Base, use “allocate…” instead.</p>
      )}
      {customError && ready && <p className="mt-2 text-sm text-amber-500">{customError}</p>}
      {mode === "custom" && ready && (!needsOtherShare || otherSum > 0) && !customError && !proposal && <p className={`mt-2 ${NOTE}`}>Reading the chains you picked…</p>}
      {ready && proposal && !plan && !customError && <p className={`mt-2 ${NOTE}`}>Reading what each chain costs…</p>}
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
            {totalWei > 0n ? `, with up to ${eth(totalWei)} ETH attached on Base (what isn't needed is refunded to your wallet, except the return fee a chain keeps)` : ""}.
          </p>
          {steps.length > 1 && (
            <ol className={`mt-2 list-decimal pl-5 text-sm text-neutral-300`}>
              {steps.map((s, i) => (
                <li key={i} className={i === 0 ? "text-neutral-100" : ""}>
                  {s.label}
                  {s.needsIdle > 0n ? ` (needs ${fmt(power(s.needsIdle))} idle power, which comes back from the return above)` : ""}
                </li>
              ))}
            </ol>
          )}
          <p className={`mt-2 text-sm text-neutral-200`}>
            Next{steps.length > 1 ? ` (1 of ${steps.length} left)` : ""}: {next.label}.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button type="button" className={btn("primary", "sm")} disabled={signing || confirming || checking || waitReason !== null} onClick={() => send(next)}>
              {checking ? "checking…" : signing ? "confirm in wallet…" : confirming ? "confirming…" : chainId !== base.id ? "switch to Base" : "send this step"}
            </button>
            {waitReason?.includes("Base is still in its wait") && <span className="text-sm text-amber-500">Still in cooldown.</span>}
          </div>
          {waitReason && <p className="mt-2 text-sm text-amber-500">{waitReason}</p>}
          <p className={`mt-2 ${NOTE}`}>
            Power on another chain shows as idle there until Aero&rsquo;s message sets its gauges, usually a few minutes. Read-only checks are made as your wallet first; nothing is sent if they fail.
          </p>
        </>
      )}
      {ready && proposal && plan && "steps" in plan && steps.length === 0 && <p className={`mt-2 ${BODY}`}>This position already matches that split.</p>}
      {hasOtherPower && address && ready && (
        <details className="mt-3">
          <summary className={`cursor-pointer select-none ${NOTE}`}>Quick actions for the chains this position is on</summary>
          <SaeroManageChains tokenId={position.tokenId} owner={address} byChain={data.byChain} power={position.votingPower} busy={signing || confirming || checking} nonce={receipt?.transactionHash ?? ""} onSend={(step) => void send(step)} />
        </details>
      )}
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
