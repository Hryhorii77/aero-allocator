"use client";

import { useState } from "react";
import { useAccount, useSwitchChain, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { simulateContract } from "wagmi/actions";
import { base } from "wagmi/chains";
import { allocateAbi, allocateArgs, explainAllocateError, planReturnAll } from "@/lib/allocate";
import { DEFAULT_COOLDOWN_SEC, SAERO, type SaeroPosition, waitHours } from "@/lib/saero";
import { BODY, btn, chip, LINK, NOTE } from "./ui";

const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });

/**
 * Takes everything a position has on Base's gauges back to idle. Needed before an expired lock can be withdrawn or a permanent
 * stake downgraded (the escrow requires the whole stake idle first), and it is the way to stop earning on a position without
 * naming new gauges. Same safety as allocating: simulated on-chain first, nothing is sent if the contract would reject it.
 * Checked on a fork of Base with a real position: it respects the 47-hour wait, returns the full amount to idle, and restarts the wait.
 */
export function SaeroReturn({ position, cooldownReady, waitHours: hours = waitHours(DEFAULT_COOLDOWN_SEC) }: { position: SaeroPosition; cooldownReady: boolean; waitHours?: number }) {
  const { chainId, address } = useAccount();
  const { switchChain } = useSwitchChain();
  const { writeContract, data: hash, isPending: signing, error: sendError, reset } = useWriteContract();
  const { isLoading: confirming, isSuccess: confirmed } = useWaitForTransactionReceipt({ hash, chainId: base.id });
  const [open, setOpen] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  if (position.onBaseRaw <= 0n) return null;
  if (!open) {
    return (
      <button type="button" className={`mr-2 mt-2 ${btn("secondary", "sm")}`} onClick={() => setOpen(true)}>
        return to idle…
      </button>
    );
  }

  const amount = Number(position.onBaseRaw) / 1e18;
  const submit = async () => {
    if (!address) return;
    setProblem(null);
    reset();
    if (chainId !== base.id) {
      switchChain({ chainId: base.id });
      return;
    }
    const args = allocateArgs(planReturnAll({ tokenId: position.tokenId, onBase: position.onBaseRaw }), address);
    setChecking(true);
    try {
      const { wagmiConfig } = await import("@/lib/wagmi");
      await simulateContract(wagmiConfig, { address: SAERO.voter, abi: allocateAbi, functionName: "allocate", args, chainId: base.id, account: address } as unknown as Parameters<typeof simulateContract>[1]);
    } catch (e) {
      setChecking(false);
      setProblem(`Aero's contract would reject this: ${explainAllocateError(e) ?? (e as { shortMessage?: string }).shortMessage ?? "simulation failed"}. Nothing was sent.`);
      return;
    }
    setChecking(false);
    writeContract({ address: SAERO.voter, abi: allocateAbi, functionName: "allocate", args, chainId: base.id });
  };

  return (
    <div className="mt-3 rounded-lg border border-neutral-800 px-3 py-3">
      <p className={BODY}>
        Take all <span className="text-neutral-100">{fmt(amount)}</span> power of this position off its gauges and park it idle. It stops earning fees and
        incentives, and the {hours}-hour wait starts again. You need this before withdrawing an expired lock or leaving a permanent stake; after the wait you
        can place idle power again with &ldquo;allocate…&rdquo;.
      </p>
      <p className={`mt-2 ${NOTE}`}>No ETH is needed on Base. The transaction is checked on-chain before your wallet is asked.</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" className={btn("warn", "sm")} disabled={!cooldownReady || signing || confirming || checking} onClick={submit}>
          {checking ? "checking…" : signing ? "confirm in wallet…" : confirming ? "confirming…" : chainId !== base.id ? "switch to Base" : "return to idle"}
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
          {confirmed ? "Returned to idle. " : "Sent. "}
          <a className={LINK} href={`https://basescan.org/tx/${hash}`} target="_blank" rel="noreferrer">
            view on Basescan ↗
          </a>
        </p>
      )}
    </div>
  );
}
