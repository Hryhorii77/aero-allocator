"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  useAccount,
  useConnect,
  useDisconnect,
  useReadContract,
  useSwitchChain,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import {
  voterAbi,
  veSugarAbi,
  multicall3Abi,
  MULTICALL3_ADDRESS,
  buildVoteArgs,
  buildVoteCalldata,
  buildMulticallVoteArgs,
} from "@/lib/voter";
import { DISPLAY_PRESET, PROTOCOL, type Protocol } from "@/lib/protocol";

interface ProtocolAddresses {
  protocol: Protocol;
  voterAddress: `0x${string}`;
  veSugarAddress: `0x${string}`;
}

/** Fetches the vote/veNFT contract addresses from the server's PRESET (single source of truth). */
function useProtocolAddresses() {
  return useQuery({
    queryKey: ["protocol-addresses"],
    queryFn: async (): Promise<ProtocolAddresses> => {
      const res = await fetch("/api/protocol");
      if (!res.ok) throw new Error(`/api/protocol: HTTP ${res.status}`);
      const data: ProtocolAddresses = await res.json();
      if (data.protocol !== PROTOCOL) {
        console.warn(
          `NEXT_PUBLIC_AERO_PROTOCOL (${PROTOCOL}) doesn't match the server's AERO_PROTOCOL (${data.protocol}) — ` +
            "set both to the same value for this deployment.",
        );
      }
      return data;
    },
    staleTime: Infinity,
  });
}

// wagmi's injected() connector announces every EIP-6963 provider the browser
// exposes, including wallets for other chains (Cosmos, ICP, Tron, Tezos, …)
// that happen to inject a provider object. Filter those out so the list only
// shows wallets a Base user would actually pick.
const NON_EVM_WALLET_NAME = /\b(plug|keplr|leap|cosmostation|station|temple|tronlink|martian|petra|sui wallet)\b/i;

function connectorDisplayName(name: string) {
  return name === "Injected" ? "Browser Wallet" : name;
}

export function ConnectButton() {
  const { address, isConnected } = useAccount();
  const { connectors, connect, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent) {
        if (e.key === "Escape") setOpen(false);
        return;
      }
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  if (isConnected && address) {
    return (
      <button
        onClick={() => disconnect()}
        title="disconnect"
        className="rounded-lg border border-neutral-700 px-3 py-1.5 font-mono text-sm text-neutral-300 hover:border-rose-800 hover:text-rose-300"
      >
        {address.slice(0, 6)}…{address.slice(-4)}
      </button>
    );
  }

  const walletConnectors = connectors.filter((c) => !NON_EVM_WALLET_NAME.test(c.name));

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        disabled={isPending}
        className="rounded-lg bg-sky-600 px-3 py-1.5 text-sm text-white hover:bg-sky-500 disabled:opacity-40"
      >
        {isPending ? "connecting…" : "connect wallet"}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10 bg-black/40" onClick={() => setOpen(false)} aria-hidden="true" />
          <div className="absolute right-0 z-20 mt-2 w-48 rounded-lg border border-neutral-700 bg-neutral-900 p-1 shadow-xl">
            <div className="flex items-center justify-between px-2 py-1">
              <span className="text-xs text-neutral-500">connect with</span>
              <button
                onClick={() => setOpen(false)}
                aria-label="close"
                className="rounded p-1 text-neutral-500 hover:bg-neutral-800 hover:text-neutral-200"
              >
                ✕
              </button>
            </div>
            {walletConnectors.map((c) => (
              <button
                key={c.uid}
                onClick={() => {
                  connect({ connector: c });
                  setOpen(false);
                }}
                className="block w-full rounded px-3 py-2 text-left text-sm text-neutral-200 hover:bg-neutral-800"
              >
                {connectorDisplayName(c.name)}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/** A veNFT's current on-chain vote split (veSugar's VeNFT.votes), each
 * weight normalized to a percentage of that NFT's own total — empty if it
 * hasn't voted yet this epoch (or ever). */
export interface CurrentVote {
  pool: string;
  weightPct: number;
}

interface VeNftOption {
  id: bigint;
  votingAmount: bigint;
  votes: CurrentVote[];
}

export function VotePanel({
  allocations,
  onNftSelected,
}: {
  allocations: Array<{
    pool: string;
    symbol: string;
    weightPct: number;
    /** Gauge's existing vote count and the vote count this allocation would add — present only for the voter_roi objective, which is the only one that actually casts a vote. Used to warn before a vote would make the caller the majority of a near-empty gauge. */
    currentVotes?: number;
    votesAllocated?: number;
  }>;
  /** Fired with the veNFT's real voting balance and its current on-chain
   * vote split when the user picks one from the dropdown (or it's
   * auto-selected), so the caller can both re-size the recommendation and
   * show a current-vs-recommended comparison. */
  onNftSelected?: (votingPower: number, currentVotes: CurrentVote[]) => void;
}) {
  const { address, isConnected, chainId } = useAccount();
  const { switchChain } = useSwitchChain();
  const [manualId, setManualId] = useState("");
  // Every detected veNFT is a candidate to batch into one signature — a
  // Set rather than a single id, since a wallet with several locks (Flight
  // School + an older max lock, the case BNKR/Grok flagged) should be able
  // to vote all of them at once instead of running this panel N times.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const { data: addresses } = useProtocolAddresses();

  // Auto-detect the wallet's veNFTs; deployed Sugar versions have
  // diverged from source before, so failure just falls back to manual entry.
  const { data: veNfts, isError: detectFailed } = useReadContract({
    address: addresses?.veSugarAddress,
    abi: veSugarAbi,
    functionName: "byAccount",
    args: address ? [address] : undefined,
    chainId: DISPLAY_PRESET.chain.id,
    query: { enabled: !!address && !!addresses, retry: 1 },
  });

  const options: VeNftOption[] = useMemo(
    () =>
      (veNfts ?? [])
        .filter((n) => n.voting_amount > 0n)
        .map((n) => {
          // LpVotes.weight is relative, not a fixed 0-100/0-10000 scale (same
          // convention Voter.vote() itself uses) — normalize to a percentage
          // of this NFT's own total so it's directly comparable to the
          // recommended split's weightPct. BigInt math throughout to avoid
          // precision loss before the final /100.
          const totalWeight = n.votes.reduce((s, v) => s + v.weight, 0n);
          return {
            id: n.id,
            votingAmount: n.voting_amount,
            votes: n.votes.map((v) => ({
              pool: v.lp,
              weightPct: totalWeight > 0n ? Number((v.weight * 10000n) / totalWeight) / 100 : 0,
            })),
          };
        }),
    [veNfts],
  );

  // Manual fallback (auto-detect failed or found nothing) also accepts a
  // comma/whitespace-separated list, so a multi-lock holder isn't forced
  // into one-at-a-time entry just because detection didn't work.
  const manualIds = useMemo(
    () =>
      manualId
        .split(/[,\s]+/)
        .map((s) => s.trim())
        .filter(Boolean),
    [manualId],
  );
  const tokenIds = options.length > 0 ? [...selectedIds] : manualIds;

  const selectNfts = (ids: Set<string>) => {
    setSelectedIds(ids);
    const selected = options.filter((o) => ids.has(o.id.toString()));
    if (selected.length === 0) return;
    if (selected.length === 1) {
      // No blending needed — forward this veNFT's own already-normalized
      // split exactly rather than round-tripping a single value through
      // the floating-point blend below for no reason.
      onNftSelected?.(Math.round(Number(selected[0].votingAmount) / 1e18), selected[0].votes);
      return;
    }
    const totalVotingAmount = selected.reduce((s, o) => s + o.votingAmount, 0n);
    const totalVotingPower = Math.round(Number(totalVotingAmount) / 1e18);
    // Blend each selected veNFT's own split into one portfolio-wide split,
    // weighted by that veNFT's own voting power — "what am I already in,
    // in aggregate" is the question a multi-veNFT holder actually has, not
    // N separate per-NFT answers the caller would have to combine itself.
    const poolAmounts = new Map<string, number>();
    for (const o of selected) {
      const amount = Number(o.votingAmount) / 1e18;
      for (const v of o.votes) {
        poolAmounts.set(v.pool, (poolAmounts.get(v.pool) ?? 0) + amount * (v.weightPct / 100));
      }
    }
    const blendedVotes: CurrentVote[] =
      totalVotingPower > 0
        ? [...poolAmounts.entries()].map(([pool, amount]) => ({ pool, weightPct: (amount / totalVotingPower) * 100 }))
        : [];
    onNftSelected?.(totalVotingPower, blendedVotes);
  };

  const toggleNft = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    selectNfts(next);
  };

  // Default to batching every detected veNFT into one signature the moment
  // they show up, instead of leaving votingPower on its 10,000 default (or
  // just the first lock) until the user manually opens this panel — a
  // wallet with several locks (Flight School + an older max lock) gets its
  // full combined voting power and current split immediately. Unchecking a
  // box below still excludes that lock from both the sizing and the vote.
  useEffect(() => {
    if (options.length > 0 && selectedIds.size === 0) {
      selectNfts(new Set(options.map((o) => o.id.toString())));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options]);

  const { writeContract, data: txHash, isPending: signing, error: writeError, reset } = useWriteContract();
  const { isLoading: confirming, isSuccess: confirmed } = useWaitForTransactionReceipt({ hash: txHash });

  const castVote = () => {
    if (tokenIds.length === 0 || allocations.length === 0 || !addresses) return;
    if (tokenIds.length === 1) {
      writeContract({
        address: addresses.voterAddress,
        abi: voterAbi,
        functionName: "vote",
        chainId: DISPLAY_PRESET.chain.id,
        args: buildVoteArgs(tokenIds[0], allocations),
      });
      return;
    }
    // More than one selected veNFT: one Voter.vote() per tokenId, batched
    // into a single Multicall3 transaction instead of N separate wallet
    // signatures.
    writeContract({
      address: MULTICALL3_ADDRESS,
      abi: multicall3Abi,
      functionName: "aggregate3",
      chainId: DISPLAY_PRESET.chain.id,
      args: buildMulticallVoteArgs(addresses.voterAddress, tokenIds, allocations),
    });
  };

  // Gauges this vote would dominate — near-empty gauges where the caller's
  // own vote would be the majority of what's there. Silently casting into
  // one of these was "the last dangerous click" (Grok round 4): the weight
  // bars and $/1k warning are visible above, but nothing stops the actual
  // vote. Recomputed from scratch (not memoized) whenever it's read, since
  // allocations is a small (<=8 row) array recreated on every recompute.
  const dominantGauges = allocations
    .map((a) => ({
      ...a,
      gaugeSharePct:
        a.votesAllocated !== undefined && a.currentVotes !== undefined && a.currentVotes + a.votesAllocated > 0
          ? (a.votesAllocated / (a.currentVotes + a.votesAllocated)) * 100
          : undefined,
    }))
    .filter((a): a is typeof a & { gaugeSharePct: number } => (a.gaugeSharePct ?? 0) > 50);

  const [showThinGaugeConfirm, setShowThinGaugeConfirm] = useState(false);

  useEffect(() => {
    setShowThinGaugeConfirm(false);
  }, [allocations]);

  const requestCastVote = () => {
    if (dominantGauges.length > 0 && !showThinGaugeConfirm) {
      setShowThinGaugeConfirm(true);
      return;
    }
    setShowThinGaugeConfirm(false);
    castVote();
  };

  const [calldataId, setCalldataId] = useState("");
  const [copied, setCopied] = useState(false);

  const copyCalldata = async () => {
    if (!calldataId || allocations.length === 0) return;
    await navigator.clipboard.writeText(buildVoteCalldata(calldataId, allocations));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const noWalletOption = (
    <div className="mt-4 rounded-lg border border-neutral-800 bg-neutral-950/40 p-3">
      <p className="mb-2 text-xs text-neutral-500">
        Prefer not to connect a wallet? Enter your veNFT id and copy the unsigned calldata for
        Voter.vote() — sign and send it with any wallet or tool you trust, to{" "}
        <span className="font-mono break-all">{addresses?.voterAddress ?? "…"}</span> on {DISPLAY_PRESET.networkName}.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          inputMode="numeric"
          placeholder="veNFT id"
          value={calldataId}
          onChange={(e) => setCalldataId(e.target.value.replace(/\D/g, ""))}
          className="w-32 rounded-lg border border-neutral-700 bg-neutral-950 px-2 py-1 font-mono text-sm text-neutral-200 focus:border-sky-600 focus:outline-none"
        />
        <button
          onClick={copyCalldata}
          disabled={!calldataId || allocations.length === 0}
          className="rounded-lg border border-neutral-700 px-3 py-1.5 text-sm text-neutral-300 hover:border-neutral-500 hover:text-white disabled:opacity-40"
        >
          {copied ? "copied!" : "copy calldata"}
        </button>
      </div>
    </div>
  );

  if (!isConnected) {
    return (
      <>
        {/* States what connecting buys you, not what the button is: the
            split above is sized for a typed guess until a wallet fills in
            the real balance and the votes already cast against it. */}
        <p className="mt-3 text-xs text-neutral-500">
          Connect to see your current votes next to this split, sized for your real{" "}
          {DISPLAY_PRESET.veTokenSymbol} balance — then cast it in one signature.
        </p>
        {noWalletOption}
      </>
    );
  }

  if (chainId !== DISPLAY_PRESET.chain.id) {
    return (
      <>
        <button
          onClick={() => switchChain({ chainId: DISPLAY_PRESET.chain.id })}
          className="mt-3 rounded-lg border border-amber-800 bg-amber-950/40 px-3 py-1.5 text-sm text-amber-300 hover:border-amber-600"
        >
          switch to {DISPLAY_PRESET.networkName} to vote
        </button>
        {noWalletOption}
      </>
    );
  }

  return (
    <>
      <div className="mt-4 rounded-lg border border-neutral-800 bg-neutral-950/60 p-3">
        <div className="flex flex-wrap items-center gap-2">
          {options.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              {options.map((o) => {
                const id = o.id.toString();
                return (
                  <label
                    key={id}
                    className="flex items-center gap-1.5 rounded-lg border border-neutral-700 bg-neutral-950 px-2 py-1 font-mono text-sm text-neutral-200"
                  >
                    <input
                      type="checkbox"
                      checked={selectedIds.has(id)}
                      onChange={() => toggleNft(id)}
                      aria-label={`veNFT #${id}`}
                      className="accent-sky-600"
                    />
                    #{id} · {Math.round(Number(o.votingAmount) / 1e18).toLocaleString()}
                  </label>
                );
              })}
              {options.length > 1 && (
                <button
                  type="button"
                  onClick={() =>
                    selectNfts(
                      selectedIds.size === options.length ? new Set() : new Set(options.map((o) => o.id.toString())),
                    )
                  }
                  className="font-mono text-xs text-neutral-500 underline hover:text-neutral-300"
                >
                  {selectedIds.size === options.length ? "select none" : "select all"}
                </button>
              )}
            </div>
          ) : (
            <input
              type="text"
              inputMode="numeric"
              placeholder={detectFailed ? "veNFT id(s), comma-separated (auto-detect failed)" : "veNFT id(s), comma-separated"}
              value={manualId}
              onChange={(e) => setManualId(e.target.value.replace(/[^\d,\s]/g, ""))}
              className="w-56 rounded-lg border border-neutral-700 bg-neutral-950 px-2 py-1 font-mono text-sm text-neutral-200 focus:border-sky-600 focus:outline-none"
            />
          )}
          <button
            onClick={requestCastVote}
            disabled={tokenIds.length === 0 || signing || confirming || allocations.length === 0 || !addresses}
            // Same shade depth as the "connect wallet" button (sky-600 /
            // hover:sky-500) — was emerald-700/600, a darker pair that read
            // as visually secondary next to it despite identical size and
            // weight (external review: "same visual weight as connect
            // wallet"). Color still carries the connect (blue) vs go
            // (green) distinction; only the brightness now matches.
            className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm text-white hover:bg-emerald-500 disabled:opacity-40"
          >
            {signing
              ? "confirm in wallet…"
              : confirming
                ? "confirming…"
                : tokenIds.length > 1
                  ? `cast ${tokenIds.length} votes`
                  : "cast vote"}
          </button>
          {txHash && (
            <a
              href={`${DISPLAY_PRESET.chain.blockExplorers?.default.url}/tx/${txHash}`}
              target="_blank"
              rel="noreferrer"
              className={`font-mono text-xs ${confirmed ? "text-emerald-400" : "text-neutral-400"} hover:underline`}
            >
              {confirmed ? "✓ voted" : "tx"} {txHash.slice(0, 10)}…
            </a>
          )}
        </div>
        {showThinGaugeConfirm && (
          <div className="mt-2 rounded-lg border border-amber-800 bg-amber-950/30 p-3 text-xs text-amber-300">
            <p className="mb-2">
              {dominantGauges.length === 1
                ? "This vote would make you the majority of the gauge below"
                : "These votes would make you the majority of the gauges below"}{" "}
              — near-empty gauge{dominantGauges.length > 1 ? "s" : ""} your vote alone would decide:
            </p>
            <ul className="mb-2 list-disc pl-4">
              {dominantGauges.map((a) => (
                <li key={a.pool}>
                  {a.symbol} — you&rsquo;d be ≈{a.gaugeSharePct.toFixed(0)}% of this gauge&rsquo;s votes
                </li>
              ))}
            </ul>
            <div className="flex gap-2">
              <button
                onClick={requestCastVote}
                className="rounded-lg bg-amber-700 px-3 py-1 text-white hover:bg-amber-600"
              >
                cast anyway
              </button>
              <button
                onClick={() => setShowThinGaugeConfirm(false)}
                className="rounded-lg border border-neutral-700 px-3 py-1 text-neutral-300 hover:border-neutral-500"
              >
                cancel
              </button>
            </div>
          </div>
        )}
        {writeError && (
          <p className="mt-2 break-all text-xs text-rose-400">
            {(writeError as { shortMessage?: string }).shortMessage ?? writeError.message}{" "}
            <button onClick={() => reset()} className="text-neutral-500 underline">
              dismiss
            </button>
          </p>
        )}
        {selectedIds.size > 0 && onNftSelected && (
          <p className="mt-2 text-xs text-sky-400">
            {selectedIds.size === 1
              ? `Weights above were re-sized for veNFT #${[...selectedIds][0]}’s real voting balance.`
              : `Weights above were re-sized for ${selectedIds.size} selected veNFTs’ combined voting balance — casting will batch ${selectedIds.size} votes into one multicall transaction.`}
          </p>
        )}
        <p className="mt-2 text-xs text-neutral-500">
          Casts Voter.vote() with the weights above. One vote per veNFT per epoch; voting is blocked in
          the final hour before Thursday 00:00 UTC.
        </p>
      </div>
      {noWalletOption}
    </>
  );
}
