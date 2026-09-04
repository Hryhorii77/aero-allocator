"use client";

import { useMemo, useState } from "react";
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
import { voterAbi, veSugarAbi, buildVoteArgs, buildVoteCalldata } from "@/lib/voter";
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

export function ConnectButton() {
  const { address, isConnected } = useAccount();
  const { connectors, connect, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const [open, setOpen] = useState(false);

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

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        disabled={isPending}
        className="rounded-lg bg-sky-600 px-3 py-1.5 text-sm text-white hover:bg-sky-500 disabled:opacity-40"
      >
        {isPending ? "connecting…" : "connect wallet"}
      </button>
      {open && (
        <div className="absolute right-0 z-10 mt-2 w-44 rounded-lg border border-neutral-700 bg-neutral-900 p-1 shadow-xl">
          {connectors.map((c) => (
            <button
              key={c.uid}
              onClick={() => {
                connect({ connector: c });
                setOpen(false);
              }}
              className="block w-full rounded px-3 py-2 text-left text-sm text-neutral-200 hover:bg-neutral-800"
            >
              {c.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

interface VeNftOption {
  id: bigint;
  votingAmount: bigint;
}

export function VotePanel({
  allocations,
}: {
  allocations: Array<{ pool: string; symbol: string; weightPct: number }>;
}) {
  const { address, isConnected, chainId } = useAccount();
  const { switchChain } = useSwitchChain();
  const [manualId, setManualId] = useState("");
  const [selectedId, setSelectedId] = useState<string>("");
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
        .map((n) => ({ id: n.id, votingAmount: n.voting_amount })),
    [veNfts],
  );

  const tokenId = selectedId || manualId;

  const { writeContract, data: txHash, isPending: signing, error: writeError, reset } = useWriteContract();
  const { isLoading: confirming, isSuccess: confirmed } = useWaitForTransactionReceipt({ hash: txHash });

  const castVote = () => {
    if (!tokenId || allocations.length === 0 || !addresses) return;
    writeContract({
      address: addresses.voterAddress,
      abi: voterAbi,
      functionName: "vote",
      chainId: DISPLAY_PRESET.chain.id,
      args: buildVoteArgs(tokenId, allocations),
    });
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
        <span className="font-mono">{addresses?.voterAddress ?? "…"}</span> on {DISPLAY_PRESET.networkName}.
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
        <p className="mt-3 text-xs text-neutral-500">
          Connect a wallet to cast this allocation as your {DISPLAY_PRESET.veTokenSymbol} vote.
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
            <select
              value={selectedId}
              onChange={(e) => setSelectedId(e.target.value)}
              className="rounded-lg border border-neutral-700 bg-neutral-950 px-2 py-1 font-mono text-sm text-neutral-200 focus:border-sky-600 focus:outline-none"
            >
              <option value="">select {DISPLAY_PRESET.veTokenSymbol} NFT</option>
              {options.map((o) => (
                <option key={o.id.toString()} value={o.id.toString()}>
                  #{o.id.toString()} · {Math.round(Number(o.votingAmount) / 1e18).toLocaleString()} votes
                </option>
              ))}
            </select>
          ) : (
            <input
              type="text"
              inputMode="numeric"
              placeholder={detectFailed ? "veNFT id (auto-detect failed)" : "veNFT id"}
              value={manualId}
              onChange={(e) => setManualId(e.target.value.replace(/\D/g, ""))}
              className="w-44 rounded-lg border border-neutral-700 bg-neutral-950 px-2 py-1 font-mono text-sm text-neutral-200 focus:border-sky-600 focus:outline-none"
            />
          )}
          <button
            onClick={castVote}
            disabled={!tokenId || signing || confirming || allocations.length === 0 || !addresses}
            className="rounded-lg bg-emerald-700 px-3 py-1.5 text-sm text-white hover:bg-emerald-600 disabled:opacity-40"
          >
            {signing ? "confirm in wallet…" : confirming ? "confirming…" : "cast vote"}
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
        {writeError && (
          <p className="mt-2 break-all text-xs text-rose-400">
            {(writeError as { shortMessage?: string }).shortMessage ?? writeError.message}{" "}
            <button onClick={() => reset()} className="text-neutral-500 underline">
              dismiss
            </button>
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
