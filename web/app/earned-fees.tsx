"use client";

import { useState } from "react";
import { readContract, readContracts } from "wagmi/actions";
import type { Address } from "viem";
import { BASE_CHAIN } from "@/lib/aero-chains";
import { erc20MetaAbi, MAX_CHECKPOINTS, registryRewardsAbi, rewardsManagerAbi, summariseEarned, type EarnedEntry, type EarnedSummary, type TokenMeta } from "@/lib/earned";
import { SAERO, SAERO_CHAIN_ID, saeroLeafAbi } from "@/lib/saero";
import { NOTE, NUM } from "./ui";

const ZERO = /^0x0+$/;
const usd = (n: number) => (n >= 0.01 || n === 0 ? n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "<0.01");
const amount = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: n >= 1 ? 2 : 6 });

/** Reads, in this browser, the fees a position has earned on the gauges it sits on now and not yet claimed. */
export async function readEarnedFees(tokenId: bigint): Promise<EarnedSummary> {
  const { wagmiConfig } = await import("@/lib/wagmi");
  const chainId = SAERO_CHAIN_ID;
  const gauges = ((await readContract(wagmiConfig, { address: SAERO.leafVoter, abi: saeroLeafAbi, functionName: "allocatedGauges", args: [tokenId], chainId })) as Address[]).filter((g) => !ZERO.test(g));
  if (gauges.length === 0) return { lines: [], totalUsd: 0, unpriced: false };
  const managers = (await readContracts(wagmiConfig, {
    allowFailure: false,
    contracts: gauges.map((g) => ({ address: BASE_CHAIN.registry, abi: registryRewardsAbi, functionName: "gaugeToRewards" as const, args: [g] as const, chainId })),
  })) as Address[];
  const res = (await readContracts(wagmiConfig, {
    allowFailure: false,
    contracts: managers.flatMap((m) => [
      { address: m, abi: rewardsManagerAbi, functionName: "earnedFees" as const, args: [tokenId, MAX_CHECKPOINTS] as const, chainId },
      { address: m, abi: rewardsManagerAbi, functionName: "token0" as const, chainId },
      { address: m, abi: rewardsManagerAbi, functionName: "token1" as const, chainId },
    ]),
  })) as unknown[];
  const entries: EarnedEntry[] = gauges.map((gauge, i) => {
    const earned = res[i * 3] as readonly [bigint, bigint];
    return { gauge, token0: res[i * 3 + 1] as Address, token1: res[i * 3 + 2] as Address, amount0: earned[0], amount1: earned[1] };
  });
  const tokens = [...new Set(entries.flatMap((e) => [e.token0, e.token1]).map((t) => t.toLowerCase()))] as Address[];
  const metaRes = (await readContracts(wagmiConfig, {
    allowFailure: true,
    contracts: tokens.flatMap((t) => [
      { address: t, abi: erc20MetaAbi, functionName: "decimals" as const, chainId },
      { address: t, abi: erc20MetaAbi, functionName: "symbol" as const, chainId },
    ]),
  })) as Array<{ status: string; result?: unknown }>;
  const meta = new Map<string, TokenMeta>();
  tokens.forEach((t, i) => {
    const d = metaRes[i * 2];
    const s = metaRes[i * 2 + 1];
    if (d.status === "success") meta.set(t, { decimals: Number(d.result), symbol: s.status === "success" ? String(s.result) : "token" });
  });
  // Only public token addresses go to our server, for prices; the position and wallet never do.
  const prices = await fetch(`/api/token-prices?tokens=${tokens.join(",")}`)
    .then((r) => (r.ok ? (r.json() as Promise<{ prices: Record<string, number> }>) : { prices: {} }))
    .then((j) => j.prices)
    .catch(() => ({}) as Record<string, number>);
  return summariseEarned(entries, meta, prices);
}

/** A button that, once pressed, shows what the position has earned in fees and not claimed. Claiming itself is done on Aero. */
export function EarnedFees({ tokenId }: { tokenId: bigint }) {
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [summary, setSummary] = useState<EarnedSummary | null>(null);

  const load = async () => {
    setState("loading");
    try {
      setSummary(await readEarnedFees(tokenId));
      setState("done");
    } catch {
      setState("error");
    }
  };

  if (state === "idle" || state === "loading") {
    return (
      <button type="button" onClick={load} disabled={state === "loading"} className="mt-2 text-sm text-sky-400 underline underline-offset-2 hover:text-sky-300 disabled:opacity-60">
        {state === "loading" ? "reading earned fees…" : "show fees earned so far"}
      </button>
    );
  }
  if (state === "error" || !summary) return <p className="mt-2 text-sm text-rose-400">Couldn&rsquo;t read the earned fees. Try again in a moment.</p>;
  if (summary.lines.length === 0) {
    return <p className={`mt-2 ${NOTE}`}>No unclaimed fees on the gauges this position is on now.</p>;
  }
  return (
    <div className="mt-2 text-sm">
      <p className="text-neutral-400">
        Unclaimed fees on its current gauges:{" "}
        <span className={`text-emerald-400 ${NUM}`}>
          {summary.unpriced ? "at least " : ""}${usd(summary.totalUsd)}
        </span>
        <span className="text-neutral-500"> ({summary.lines.map((l) => `${amount(l.amount)} ${l.symbol}`).join(", ")})</span>
      </p>
      <p className={NOTE}>
        Fees only, on the gauges it sits on now; incentives and anything left on gauges it has left are not counted. Claim on Aero.
      </p>
    </div>
  );
}
