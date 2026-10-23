"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { LINK } from "./ui";

export interface WalletOption {
  uid: string;
  id: string;
  name: string;
  /** EIP-6963 wallets announce an icon (data URI or URL); others don't. */
  icon?: string;
}

interface Props {
  /** Wallets that announced themselves by name (EIP-6963) — "Installed". */
  installed: WalletOption[];
  /** Everything else worth offering — "Popular". */
  popular: WalletOption[];
  /** Connector id of the wallet used last time, if any. */
  recentId?: string | null;
  onPick: (id: string) => void;
  onClose: () => void;
}

const LEARN_MORE_URL = "https://ethereum.org/en/wallets/find-wallet/";

function WalletIcon({ wallet }: { wallet: WalletOption }) {
  if (wallet.icon) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={wallet.icon} alt="" width={28} height={28} className="h-7 w-7 rounded-md" />;
  }
  if (wallet.id.toLowerCase().includes("coinbase")) {
    return (
      <svg viewBox="0 0 28 28" width="28" height="28" aria-hidden="true" className="h-7 w-7 rounded-md">
        <rect width="28" height="28" rx="6" fill="#0052ff" />
        <circle cx="14" cy="14" r="8" fill="#fff" />
        <rect x="10.5" y="10.5" width="7" height="7" rx="1.5" fill="#0052ff" />
      </svg>
    );
  }
  return (
    <svg
      viewBox="0 0 24 24"
      width="28"
      height="28"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="h-7 w-7 rounded-md bg-neutral-800 p-1.5 text-neutral-300"
    >
      <rect x="3" y="6" width="18" height="13" rx="2.5" />
      <path d="M3 10h18" />
      <circle cx="16.5" cy="14.5" r="1" fill="currentColor" />
    </svg>
  );
}

function Section({
  title,
  wallets,
  recentId,
  onPick,
  accent,
}: {
  title: string;
  wallets: WalletOption[];
  recentId?: string | null;
  onPick: (id: string) => void;
  accent?: boolean;
}) {
  if (wallets.length === 0) return null;
  return (
    <div className="mt-3 first:mt-0">
      <div className={`px-2 pb-1 text-xs font-semibold ${accent ? "text-sky-400" : "text-neutral-500"}`}>{title}</div>
      {wallets.map((w) => (
        <button
          key={w.uid}
          type="button"
          onClick={() => onPick(w.uid)}
          className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-neutral-800"
        >
          <WalletIcon wallet={w} />
          <span className="flex flex-col leading-tight">
            <span className="text-sm font-medium text-neutral-100">{w.name}</span>
            {recentId && w.id === recentId && <span className="text-xs font-semibold text-sky-400">Recent</span>}
          </span>
        </button>
      ))}
    </div>
  );
}

/** "Connect a Wallet" dialog: installed wallets first, then popular ones. Rendered into
 * document.body so it covers the whole page — the sticky header it is opened from would
 * otherwise trap a fixed overlay inside itself. */
export function WalletModal({ installed, popular, recentId, onPick, onClose }: Props) {
  const [mounted, setMounted] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  // The parent re-renders on every wallet-state change; keeping the latest
  // onClose in a ref lets the effect below run once (focus once, one listener).
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    setMounted(true);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (mounted) closeRef.current?.focus();
  }, [mounted]);

  if (!mounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Connect a Wallet"
        className="flex max-h-[80vh] w-full max-w-[360px] flex-col rounded-2xl border border-neutral-700 bg-neutral-900 p-4 shadow-xl"
      >
        <div className="relative mb-3 text-center">
          <h2 className="text-sm font-semibold text-neutral-100">Connect a Wallet</h2>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="close"
            className="absolute right-0 top-1/2 -translate-y-1/2 rounded-full p-1 text-neutral-500 hover:bg-neutral-800 hover:text-neutral-200"
          >
            ✕
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <Section title="Installed" wallets={installed} recentId={recentId} onPick={onPick} accent />
          <Section title="Popular" wallets={popular} recentId={recentId} onPick={onPick} />
        </div>
        <div className="mt-3 flex items-center justify-between border-t border-neutral-800 pt-3 text-xs text-neutral-500">
          <span>New to Ethereum wallets?</span>
          <a href={LEARN_MORE_URL} target="_blank" rel="noreferrer" className={LINK}>
            Learn More
          </a>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** wagmi remembers the last connector it connected with under this key. */
export function readRecentConnectorId(): string | null {
  try {
    const raw = localStorage.getItem("wagmi.recentConnectorId");
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      return typeof parsed === "string" ? parsed : null;
    } catch {
      return raw;
    }
  } catch {
    return null;
  }
}
