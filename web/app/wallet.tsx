"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAccount, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { DISPLAY_PRESET, PROTOCOL, type Protocol } from "@/lib/protocol";
import { btn } from "./ui";
import { WalletModal, readRecentConnectorId } from "./wallet-modal";

interface ProtocolAddresses {
  protocol: Protocol;
  voterAddress: `0x${string}`;
  veSugarAddress: `0x${string}`;
}

/** Fetches the vote/veNFT contract addresses from the server's PRESET (single source of truth). */
export function useProtocolAddresses() {
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
  if (name === "Injected") return "Browser Wallet";
  // WalletConnect's window is a search over hundreds of wallets, not one wallet.
  if (name === "WalletConnect") return "Other wallets";
  return name;
}

export function ConnectButton() {
  const { address, isConnected, chainId, connector } = useAccount();
  const { connectors, connect, isPending, reset } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain, isPending: switching, error: switchError } = useSwitchChain();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // A phone's normal browser has no extensions, so the list (Browser Wallet, Coinbase's SDK popup)
  // can't connect there. With WalletConnect configured, "connect wallet" opens WalletConnect's own
  // wallet window directly: search, pick, approve in the app, come back. Not applied inside a wallet
  // app's own browser, which injects a provider. Read after mount so server and client HTML agree.
  const [noExtensions, setNoExtensions] = useState(false);
  useEffect(() => {
    setNoExtensions(
      /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) && !(window as { ethereum?: unknown }).ethereum,
    );
  }, []);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent) {
        if (e.key === "Escape") setOpen(false);
        return;
      }
      // Outside-click closing is for the connected account panel only; the
      // connect dialog is a portal with its own backdrop.
      if (isConnected && menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open, isConnected]);

  if (isConnected && address) {
    // Clicking the address opens an account panel instead of disconnecting
    // on the spot (an easy mis-tap). Only a known other chain counts as
    // wrong: chainId is undefined while a connection is settling.
    const wrongNetwork = chainId !== undefined && chainId !== DISPLAY_PRESET.chain.id;
    const short = `${address.slice(0, 6)}…${address.slice(-4)}`;
    const explorer = DISPLAY_PRESET.chain.blockExplorers?.default;
    const copyAddress = async () => {
      try {
        await navigator.clipboard.writeText(address);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      } catch {
        // Clipboard can be blocked; the full address is shown in the panel to select.
      }
    };
    return (
      <div className="relative" ref={menuRef}>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-haspopup="dialog"
          aria-label={wrongNetwork ? "wallet, wrong network" : `wallet ${short}`}
          title="wallet"
          className={`rounded-lg border px-3 py-1.5 font-mono text-sm ${
            wrongNetwork
              ? "border-amber-800 bg-amber-950/40 text-amber-300 hover:border-amber-600"
              : "border-neutral-700 text-neutral-300 hover:border-neutral-500 hover:text-white"
          }`}
        >
          {wrongNetwork ? "wrong network" : short}
        </button>
        {open && (
          <div
            role="dialog"
            aria-label="wallet"
            className="absolute right-0 z-20 mt-2 w-72 rounded-xl border border-neutral-700 bg-neutral-900 p-4 shadow-xl"
          >
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-xs text-neutral-400">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" aria-hidden="true" />
                connected wallet
              </span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="close"
                className="rounded p-1 text-neutral-500 hover:bg-neutral-800 hover:text-neutral-200"
              >
                ✕
              </button>
            </div>
            <div className="mt-2 font-mono text-lg text-neutral-100">{short}</div>
            {connector?.name && <div className="text-xs text-neutral-500">{connectorDisplayName(connector.name)}</div>}
            <div className="mt-2 break-all font-mono text-xs text-neutral-500">{address}</div>
            <div className="mt-3 flex gap-2">
              <button type="button" onClick={copyAddress} className={`flex-1 ${btn("secondary", "sm")}`}>
                {copied ? "copied" : "copy address"}
              </button>
              {explorer && (
                <a
                  href={`${explorer.url}/address/${address}`}
                  target="_blank"
                  rel="noreferrer"
                  className={`flex-1 text-center ${btn("secondary", "sm")}`}
                >
                  {explorer.name} ↗
                </a>
              )}
            </div>
            <div className="mt-3 border-t border-neutral-800 pt-3">
              <div className="text-xs text-neutral-500">network</div>
              {wrongNetwork ? (
                <>
                  <p className="mt-1 text-xs text-amber-300">
                    Your wallet is on another network. This app votes on {DISPLAY_PRESET.networkName} only.
                  </p>
                  <button
                    type="button"
                    disabled={switching}
                    onClick={() => switchChain({ chainId: DISPLAY_PRESET.chain.id })}
                    className={`mt-2 ${btn("warn", "sm")}`}
                  >
                    {switching ? "check your wallet…" : `switch to ${DISPLAY_PRESET.networkName}`}
                  </button>
                  {switchError && (
                    <p className="mt-1 text-xs text-amber-500">Couldn&rsquo;t switch. Change the network in your wallet.</p>
                  )}
                </>
              ) : (
                <div className="mt-1 flex items-center justify-between rounded-lg border border-neutral-800 px-3 py-1.5 text-sm text-neutral-200">
                  <span>{DISPLAY_PRESET.networkName}</span>
                  <span aria-hidden="true">✓</span>
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => {
                disconnect();
                setOpen(false);
              }}
              className="mt-3 flex w-full items-center justify-between border-t border-neutral-800 pt-3 text-sm text-neutral-300 hover:text-rose-300"
            >
              <span>disconnect</span>
              <span className="text-xs text-neutral-500">this site only</span>
            </button>
          </div>
        )}
      </div>
    );
  }

  // The generic "Browser Wallet" (injected) entry only matters when no wallet
  // announced itself by name (EIP-6963); next to Rabby/MetaMask/Phantom it is
  // a duplicate that opens whichever of them happens to be the default.
  const hasNamedInjected = connectors.some((c) => c.type === "injected" && c.id !== "injected");
  const evmConnectors = connectors.filter((c) => !NON_EVM_WALLET_NAME.test(c.name));
  const walletConnectConnector = connectors.find((c) => c.type === "walletConnect");
  const toOption = (c: (typeof connectors)[number]) => ({
    uid: c.uid,
    id: c.id,
    name: connectorDisplayName(c.name),
    icon: c.icon,
  });
  const installed = evmConnectors.filter((c) => c.type === "injected" && c.id !== "injected").map(toOption);
  const popular = evmConnectors
    .filter(
      (c) =>
        !(c.type === "injected" && c.id !== "injected") &&
        !(hasNamedInjected && c.id === "injected") &&
        !(noExtensions && c.id === "injected"),
    )
    .map(toOption);

  return (
    <div className="relative" ref={menuRef}>
      {/* A wallet extension's popup closes when you click elsewhere, but the
          request stays pending in the wallet — so the button must not lock
          until it resolves. While waiting, clicking it cancels and returns
          to the list. */}
      <button
        onClick={() => {
          if (isPending) reset();
          if (walletConnectConnector && noExtensions) {
            connect({ connector: walletConnectConnector });
          } else if (isPending) {
            setOpen(true);
          } else {
            setOpen((v) => !v);
          }
        }}
        title={isPending ? "Approve in your wallet, or click to cancel and pick again" : undefined}
        className={btn("primary")}
      >
        {isPending ? "approve in wallet… (cancel)" : "connect wallet"}
      </button>
      {open && (
        <WalletModal
          installed={installed}
          popular={popular}
          recentId={readRecentConnectorId()}
          onClose={() => setOpen(false)}
          onPick={(uid) => {
            const c = connectors.find((x) => x.uid === uid);
            if (c) connect({ connector: c });
            setOpen(false);
          }}
        />
      )}
    </div>
  );
}
