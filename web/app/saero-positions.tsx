"use client";

import { useCallback, useEffect, useState } from "react";
import { useAccount } from "wagmi";
import { readContract, readContracts } from "wagmi/actions";
import { getAddress, isAddress } from "viem";
import { DISPLAY_PRESET } from "@/lib/protocol";
import {
  allocatedPct,
  cooldownState,
  DEFAULT_COOLDOWN_SEC,
  formatDuration,
  SAERO,
  SAERO_CHAIN_ID,
  saeroEscrowAbi,
  saeroLeafAbi,
  saeroVoterAbi,
  type SaeroPosition,
} from "@/lib/saero";
import { AERO_LAUNCH_AT_MS } from "./launch";
import { reminderIcs } from "@/lib/ics";
import { SITE_URL } from "@/lib/site";
import { totalCostText } from "@/lib/opportunity";
import { EarnedFees } from "./earned-fees";
import { PositionAdviceLine } from "./position-advice-line";
import { SaeroAllocate } from "./saero-allocate";
import { SaeroReturn } from "./saero-return";
import { btn, H2, input as inputCls, LINK, NOTE, NUM } from "./ui";

const MAX_POSITIONS = 25;
const CALLS_PER_POSITION = 6;
const toTokens = (v: bigint) => Number(v) / 1e18;

/** Reads every sAERO position of an address straight from Base in this browser, so the address never reaches our server. */
export async function readSaeroPositions(owner: `0x${string}`): Promise<{ positions: SaeroPosition[]; cooldownSec: number }> {
  const { wagmiConfig } = await import("@/lib/wagmi");
  const chainId = SAERO_CHAIN_ID;
  const count = await readContract(wagmiConfig, {
    address: SAERO.votingEscrow,
    abi: saeroEscrowAbi,
    functionName: "balanceOf",
    args: [owner],
    chainId,
  });
  const n = Math.min(Number(count), MAX_POSITIONS);
  const cooldownSec = await readContract(wagmiConfig, {
    address: SAERO.leafVoter,
    abi: saeroLeafAbi,
    functionName: "allocationCooldown",
    chainId,
  })
    .then(Number)
    .catch(() => DEFAULT_COOLDOWN_SEC);
  if (n === 0) return { positions: [], cooldownSec };

  const idRes = await readContracts(wagmiConfig, {
    allowFailure: false,
    contracts: Array.from({ length: n }, (_, i) => ({
      address: SAERO.votingEscrow,
      abi: saeroEscrowAbi,
      functionName: "tokenOfOwnerByIndex" as const,
      args: [owner, BigInt(i)] as const,
      chainId,
    })),
  });
  const ids = idRes as bigint[];
  const calls = ids.flatMap((id) => [
    { address: SAERO.votingEscrow, abi: saeroEscrowAbi, functionName: "staked" as const, args: [id] as const, chainId },
    { address: SAERO.votingEscrow, abi: saeroEscrowAbi, functionName: "balanceOfNFT" as const, args: [id] as const, chainId },
    { address: SAERO.voter, abi: saeroVoterAbi, functionName: "tokenStates" as const, args: [id] as const, chainId },
    { address: SAERO.leafVoter, abi: saeroLeafAbi, functionName: "tokenStates" as const, args: [id] as const, chainId },
    { address: SAERO.voter, abi: saeroVoterAbi, functionName: "allocationChainAmounts" as const, args: [id, 0n] as const, chainId },
    { address: SAERO.voter, abi: saeroVoterAbi, functionName: "allocationChainAmounts" as const, args: [id, BigInt(SAERO_CHAIN_ID)] as const, chainId },
  ]);
  const res = (await readContracts(wagmiConfig, { allowFailure: false, contracts: calls as never })) as unknown[];
  const positions = ids.map((tokenId, i): SaeroPosition => {
    const o = i * CALLS_PER_POSITION;
    const staked = res[o] as { amount: bigint; end: number; isPermanent: boolean };
    const vp = res[o + 1] as bigint;
    const state = res[o + 2] as readonly [bigint, number, number, boolean];
    const leaf = res[o + 3] as readonly [string, number, boolean, bigint];
    const parkedRaw = res[o + 4] as bigint;
    const onBaseRaw = res[o + 5] as bigint;
    return {
      tokenId,
      staked: toTokens(staked.amount),
      votingPower: toTokens(vp),
      endSec: staked.isPermanent ? 0 : Number(staked.end),
      isPermanent: staked.isPermanent,
      committed: toTokens(state[0]),
      parked: toTokens(parkedRaw),
      parkedRaw,
      onBaseRaw,
      lastAllocatedSec: Number(leaf[1]),
      ...(!/^0x0+$/.test(leaf[0]) ? { operator: leaf[0] } : {}),
    };
  });
  return { positions, cooldownSec };
}

const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });

/** Saves a calendar event for the moment a position's wait ends. Built here from numbers already on the page; nothing is sent anywhere. */
function ReminderButton({ tokenId, readyAtSec }: { tokenId: bigint; readyAtSec: number }) {
  const save = () => {
    const ics = reminderIcs({ tokenId: tokenId.toString(), readyAtSec, url: `${SITE_URL}/#positions`, nowSec: Math.floor(Date.now() / 1000) });
    const url = URL.createObjectURL(new Blob([ics], { type: "text/calendar;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `saero-${tokenId}-reallocate.ics`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <button type="button" onClick={save} className="text-amber-500 underline underline-offset-2 hover:text-amber-400" title="Saves a calendar event for when this position can be re-allocated">
      remind me
    </button>
  );
}

/** Read-only view of your sAERO positions after the Aero launch: size, lock end, how much is allocated and when each can be re-allocated. */
export function SaeroPositions() {
  const { address: connected } = useAccount();
  const [live, setLive] = useState(false);
  const [input, setInput] = useState("");
  const [state, setState] = useState<"idle" | "loading" | "invalid" | "error" | "done">("idle");
  const [owner, setOwner] = useState<`0x${string}` | null>(null);
  const [result, setResult] = useState<{ positions: SaeroPosition[]; cooldownSec: number } | null>(null);
  const [nowSec, setNowSec] = useState(() => Math.floor(Date.now() / 1000));
  // What each position leaves on the table by staying, USD/day, reported by its advice line.
  const [costs, setCosts] = useState<Record<string, number>>({});
  const onCost = useCallback((tokenId: bigint, usdPerDay: number) => setCosts((prev) => (prev[tokenId.toString()] === usdPerDay ? prev : { ...prev, [tokenId.toString()]: usdPerDay })), []);

  useEffect(() => {
    setLive(DISPLAY_PRESET.protocol === "aerodrome" && Date.now() >= AERO_LAUNCH_AT_MS);
    const t = setInterval(() => setNowSec(Math.floor(Date.now() / 1000)), 30_000);
    return () => clearInterval(t);
  }, []);

  const load = async (raw: string) => {
    if (!isAddress(raw.trim())) {
      setState("invalid");
      return;
    }
    const account = getAddress(raw.trim());
    setState("loading");
    setOwner(account);
    setCosts({});
    try {
      setResult(await readSaeroPositions(account));
      setState("done");
    } catch {
      setState("error");
    }
  };

  const costText = totalCostText(Object.values(costs));
  if (!live) return null;
  return (
    <section id="positions" className="mt-4 scroll-mt-36 rounded-xl border border-neutral-800 bg-neutral-900/40 px-3 py-4 sm:px-5">
      <h2 className={H2}>Your sAERO positions</h2>
      <p className={`mt-1 ${NOTE}`}>
        Read from Aero&rsquo;s new contracts on Base, in this browser. Each position can be re-allocated 47 hours after its last
        allocation.
      </p>
      <details className="mt-1">
        <summary className={`cursor-pointer select-none ${NOTE}`}>Want to move more often than every 47 hours?</summary>
        <p className={`mt-1 ${NOTE}`}>
          The wait belongs to each position, not to your wallet, and a position that has never been allocated has no wait (checked on Base: its
          first allocation simulates cleanly). So holding your AERO as several separate positions lets you move one while the others wait. There
          is no way to split an existing position (Aero&rsquo;s escrow has no split function), so this means staking in separate positions from
          the start, and every allocation is its own transaction with its own gas.
        </p>
      </details>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {connected && (
          <button type="button" className={btn("primary", "sm")} onClick={() => load(connected)} disabled={state === "loading"}>
            {state === "loading" ? "reading…" : "use my wallet"}
          </button>
        )}
        <input
          type="text"
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            if (state !== "loading") setState("idle");
          }}
          onBlur={() => {
            if (input.trim() !== "" && !isAddress(input.trim()) && state !== "loading") setState("invalid");
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") load(input);
          }}
          placeholder={connected ? "or paste another address" : "paste an address (0x…)"}
          aria-label="address to read sAERO positions for"
          aria-invalid={state === "invalid"}
          aria-describedby={state === "invalid" ? "address-error" : undefined}
          spellCheck={false}
          autoComplete="off"
          className={inputCls(state === "invalid", `min-w-0 flex-1 basis-56 sm:max-w-sm ${NUM}`)}
        />
        <button type="button" className={btn("secondary", "sm")} onClick={() => load(input)} disabled={state === "loading" || input.trim() === ""}>
          read
        </button>
      </div>
      {state === "invalid" && (
        <p id="address-error" role="alert" className="mt-2 text-sm text-rose-400">
          That isn&rsquo;t an address. It starts with 0x and has 42 characters.
        </p>
      )}
      {state === "error" && <p className="mt-2 text-sm text-rose-400">Read failed. Try again in a moment.</p>}
      {state === "done" && result && result.positions.length === 0 && (
        <p className="mt-3 text-sm text-amber-500">
          No sAERO positions at {owner?.slice(0, 6)}…{owner?.slice(-4)}. Upgrade a veAERO lock on{" "}
          <a href="https://aero.xyz/aero-upgrade/" target="_blank" rel="noreferrer" className={LINK}>
            Aero&rsquo;s Upgrade Hub
          </a>{" "}
          first.
        </p>
      )}
      {state === "done" && costText && <p className="mt-3 text-sm text-neutral-300">{costText}</p>}
      {state === "done" && result && result.positions.length > 0 && (
        <ul className="mt-3 grid grid-cols-[minmax(0,1fr)] gap-2">
          {result.positions.map((p) => {
            const cd = cooldownState(p.lastAllocatedSec, result.cooldownSec, nowSec);
            return (
              <li key={p.tokenId.toString()} className="rounded-lg border border-neutral-800 px-3 py-3 text-sm text-neutral-400">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <span className={`font-semibold text-neutral-100 ${NUM}`}>#{p.tokenId.toString()}</span>
                  <span>
                    <span className={`text-neutral-200 ${NUM}`}>{fmt(p.staked)}</span> AERO staked ·{" "}
                    <span className={`text-neutral-200 ${NUM}`}>{fmt(p.votingPower)}</span> power
                  </span>
                </div>
                <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1">
                  <span>
                    {p.isPermanent ? "permanent" : `locked to ${new Date(p.endSec * 1000).toISOString().slice(0, 10)}`}
                  </span>
                  <span>
                    <span className="text-neutral-200">{Math.round(allocatedPct(p))}%</span> allocated
                  </span>
                  <span className={cd.ready ? "text-emerald-400" : "text-amber-500"}>
                    {cd.ready ? "ready to allocate" : `next allocation in ${formatDuration(cd.secondsLeft)}`}
                    {!cd.ready && (
                      <>
                        {" · "}
                        <ReminderButton tokenId={p.tokenId} readyAtSec={cd.readyAtSec} />
                      </>
                    )}
                  </span>
                </div>
                {p.staked === 0 && (
                  <p className="mt-2 text-amber-500">
                    No AERO is staked in this position, so there is nothing to allocate here. If you deposited it into an Aero Autopilot, this NFT is only
                    the key to withdraw it, and Aero manages the allocation (to allocate by hand, turn Autopilot off on Aero first).
                  </p>
                )}
                {p.staked > 0 && <PositionAdviceLine position={p} onCost={onCost} />}
                {p.staked > 0 && <EarnedFees tokenId={p.tokenId} />}
                {p.operator && (
                  <p className="mt-2 text-amber-500">
                    An operator ({p.operator.slice(0, 6)}…{p.operator.slice(-4)}) is set on this position and can change its gauge allocation on Base. If it is an Aero
                    Autopilot, manage the position on Aero.
                  </p>
                )}
                {p.staked > 0 && connected && owner && connected.toLowerCase() === owner.toLowerCase() && (
                  <>
                    <SaeroAllocate position={p} cooldownReady={cd.ready} />
                    <SaeroReturn position={p} cooldownReady={cd.ready} />
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
