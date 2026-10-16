"use client";

import { useEffect, useRef, useState } from "react";
import { useAccount, useSwitchChain, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { base } from "wagmi/chains";
import { erc20Abi, parseUnits } from "viem";
import { btn, LINK } from "./ui";

/** Where tips go: a plain wallet on Base, public by design. */
export const TIP_ADDRESS = "0x9b3F205E43dc9FcC1cc2Fe6d9dCD0357769A6Bae" as const;
/** Native USDC on Base (6 decimals). */
export const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;
export const TIP_AMOUNTS_USD = [1, 5, 20] as const;

/**
 * A quiet "tip" button. It opens a small panel with the address to copy and,
 * when a wallet is connected, one-tap USDC amounts. Nothing is required and
 * nothing is gated behind it. Tips are USDC on Base whichever protocol this
 * deployment shows, so sending needs the wallet to be on Base.
 */
export function TipJar({ placement = "down" }: { placement?: "down" | "up" }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const { isConnected, chainId } = useAccount();
  const { switchChain, isPending: switching } = useSwitchChain();
  const { writeContract, data: hash, isPending: signing, error, reset } = useWriteContract();
  const { isSuccess: confirmed } = useWaitForTransactionReceipt({ hash });

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(TIP_ADDRESS);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard can be blocked; the full address is shown to select.
    }
  };

  const send = (usd: number) =>
    writeContract({
      address: BASE_USDC,
      abi: erc20Abi,
      functionName: "transfer",
      args: [TIP_ADDRESS, parseUnits(String(usd), 6)],
      chainId: base.id,
    });

  const onBase = chainId === base.id;
  const rejected = error && /reject|denied/i.test(error.message);

  return (
    <div className="relative" ref={wrapRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
        className={btn("secondary")}
      >
        ♥ tip
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="tip the developer"
          className={`absolute left-0 z-20 w-[min(20rem,calc(100vw-2rem))] rounded-xl border border-neutral-700 bg-neutral-900 p-4 shadow-xl ${
            placement === "up" ? "bottom-full mb-2" : "mt-2"
          }`}
        >
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm text-neutral-200">
              The app is free and stays free. If it helped your vote, a tip keeps it running.
            </p>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="close"
              className="rounded p-1 text-neutral-500 hover:bg-neutral-800 hover:text-neutral-200"
            >
              ✕
            </button>
          </div>
          <div className="mt-3 text-xs text-neutral-500">USDC on Base</div>
          <div className="mt-1 break-all font-mono text-[11px] text-neutral-400">{TIP_ADDRESS}</div>
          <div className="mt-2 flex gap-2">
            <button type="button" onClick={copy} className={`flex-1 ${btn("secondary", "sm")}`}>
              {copied ? "copied" : "copy address"}
            </button>
            <a
              href={`https://basescan.org/address/${TIP_ADDRESS}`}
              target="_blank"
              rel="noreferrer"
              className={`flex-1 text-center ${btn("secondary", "sm")}`}
            >
              basescan ↗
            </a>
          </div>
          {isConnected && (
            <div className="mt-3 border-t border-neutral-800 pt-3">
              {onBase ? (
                <>
                  <div className="text-xs text-neutral-500">or send from your wallet</div>
                  <div className="mt-2 flex gap-2">
                    {TIP_AMOUNTS_USD.map((usd) => (
                      <button
                        key={usd}
                        type="button"
                        disabled={signing}
                        onClick={() => {
                          reset();
                          send(usd);
                        }}
                        className={`flex-1 ${btn("secondary", "sm")}`}
                      >
                        ${usd}
                      </button>
                    ))}
                  </div>
                  {signing && <p className="mt-2 text-xs text-neutral-400">approve in your wallet…</p>}
                  {hash && !confirmed && <p className="mt-2 text-xs text-neutral-400">sent, confirming…</p>}
                  {confirmed && hash && (
                    <p className="mt-2 text-xs text-emerald-400">
                      thank you!{" "}
                      <a href={`https://basescan.org/tx/${hash}`} target="_blank" rel="noreferrer" className={LINK}>
                        view tx ↗
                      </a>
                    </p>
                  )}
                  {error && !rejected && (
                    <p className="mt-2 text-xs text-amber-500">Couldn&rsquo;t send. Copy the address instead.</p>
                  )}
                </>
              ) : (
                <button
                  type="button"
                  disabled={switching}
                  onClick={() => switchChain({ chainId: base.id })}
                  className={btn("warn", "sm")}
                >
                  {switching ? "check your wallet…" : "switch to Base to send"}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
