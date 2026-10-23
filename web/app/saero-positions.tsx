"use client";

import { useEffect, useState } from "react";
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
import { SaeroAllocate } from "./saero-allocate";
import { btn, LINK } from "./ui";

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
    };
  });
  return { positions, cooldownSec };
}

const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });

/** Read-only view of your sAERO positions after the Aero launch: size, lock end, how much is allocated and when each can be re-allocated. */
export function SaeroPositions() {
  const { address: connected } = useAccount();
  const [live, setLive] = useState(false);
  const [input, setInput] = useState("");
  const [state, setState] = useState<"idle" | "loading" | "invalid" | "error" | "done">("idle");
  const [owner, setOwner] = useState<`0x${string}` | null>(null);
  const [result, setResult] = useState<{ positions: SaeroPosition[]; cooldownSec: number } | null>(null);
  const [nowSec, setNowSec] = useState(() => Math.floor(Date.now() / 1000));

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
    try {
      setResult(await readSaeroPositions(account));
      setState("done");
    } catch {
      setState("error");
    }
  };

  if (!live) return null;
  return (
    <section className="mt-3 rounded-lg border border-neutral-800 bg-neutral-900/40 px-3 py-3">
      <h2 className="text-sm font-medium text-neutral-100">Your sAERO positions</h2>
      <p className="mt-1 text-xs text-neutral-500">
        Read from Aero&rsquo;s new contracts on Base, in this browser. Each position can be re-allocated 47 hours after its last
        allocation.
      </p>
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
          onKeyDown={(e) => {
            if (e.key === "Enter") load(input);
          }}
          placeholder={connected ? "or paste another address" : "paste an address (0x…)"}
          aria-label="address to read sAERO positions for"
          spellCheck={false}
          className="w-64 max-w-full rounded-lg border border-neutral-700 bg-neutral-950 px-2 py-1 font-mono text-xs text-neutral-200 placeholder:text-neutral-600 focus:border-sky-600 focus:outline-none"
        />
        <button type="button" className={btn("secondary", "sm")} onClick={() => load(input)} disabled={state === "loading" || input.trim() === ""}>
          read
        </button>
        {state === "invalid" && <span className="text-xs text-amber-500">That isn&rsquo;t an address.</span>}
        {state === "error" && <span className="text-xs text-rose-400">Read failed. Try again in a moment.</span>}
      </div>
      {state === "done" && result && result.positions.length === 0 && (
        <p className="mt-3 text-xs text-amber-500">
          No sAERO positions at {owner?.slice(0, 6)}…{owner?.slice(-4)}. Upgrade a veAERO lock on{" "}
          <a href="https://aero.xyz/aero-upgrade/" target="_blank" rel="noreferrer" className={LINK}>
            Aero&rsquo;s Upgrade Hub
          </a>{" "}
          first.
        </p>
      )}
      {state === "done" && result && result.positions.length > 0 && (
        <ul className="mt-3 grid grid-cols-[minmax(0,1fr)] gap-2">
          {result.positions.map((p) => {
            const cd = cooldownState(p.lastAllocatedSec, result.cooldownSec, nowSec);
            return (
              <li key={p.tokenId.toString()} className="rounded-md border border-neutral-800 px-2 py-2 text-xs text-neutral-400">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <span className="font-mono text-neutral-200">#{p.tokenId.toString()}</span>
                  <span>
                    <span className="font-mono text-neutral-200">{fmt(p.staked)}</span> AERO staked ·{" "}
                    <span className="font-mono text-neutral-200">{fmt(p.votingPower)}</span> power
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap gap-x-3">
                  <span>
                    {p.isPermanent ? "permanent" : `locked to ${new Date(p.endSec * 1000).toISOString().slice(0, 10)}`}
                  </span>
                  <span>
                    <span className="text-neutral-200">{Math.round(allocatedPct(p))}%</span> allocated
                  </span>
                  <span className={cd.ready ? "text-emerald-400" : "text-amber-500"}>
                    {cd.ready ? "ready to allocate" : `next allocation in ${formatDuration(cd.secondsLeft)}`}
                  </span>
                </div>
                {connected && owner && connected.toLowerCase() === owner.toLowerCase() && <SaeroAllocate position={p} cooldownReady={cd.ready} />}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
