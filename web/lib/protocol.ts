// Client-safe mirror of the engine's protocol preset (src/config.ts), for
// building two protocol-fixed deployments of this same dashboard (one
// Aerodrome/Base, one Velodrome/Optimism — see README's Multi-protocol
// section) with a switcher link between them. No "use client" here — these
// are plain values, safe to import from both server (layout.tsx metadata)
// and client (page.tsx, wallet.tsx) code.
//
// Only display strings and the (public, non-secret) chain object live here,
// read from NEXT_PUBLIC_AERO_PROTOCOL so Next.js can inline them into the
// client bundle. Contract addresses are NOT duplicated here — those come
// from /api/protocol (see useProtocolAddresses in wallet.tsx), which reads
// the engine's PRESET server-side, so there is exactly one source of truth
// for anything used in an on-chain vote transaction.
import { base, optimism, type Chain } from "wagmi/chains";

export type Protocol = "aerodrome" | "velodrome";

function resolveProtocol(env: string | undefined): Protocol {
  return env === "velodrome" ? "velodrome" : "aerodrome";
}

export const PROTOCOL: Protocol = resolveProtocol(process.env.NEXT_PUBLIC_AERO_PROTOCOL);

interface ProtocolDisplay {
  protocol: Protocol;
  displayName: string;
  tokenSymbol: string;
  veTokenSymbol: string;
  networkName: string;
  chain: Chain;
  defaultRpcUrl: string;
}

const DISPLAY: Record<Protocol, ProtocolDisplay> = {
  aerodrome: {
    protocol: "aerodrome",
    displayName: "Aerodrome",
    tokenSymbol: "AERO",
    veTokenSymbol: "veAERO",
    networkName: "Base",
    chain: base,
    defaultRpcUrl: "https://base-rpc.publicnode.com",
  },
  velodrome: {
    protocol: "velodrome",
    displayName: "Velodrome",
    tokenSymbol: "VELO",
    veTokenSymbol: "veVELO",
    networkName: "Optimism",
    chain: optimism,
    defaultRpcUrl: "https://mainnet.optimism.io",
  },
};

export const DISPLAY_PRESET = DISPLAY[PROTOCOL];
export const SIBLING_PRESET = DISPLAY[PROTOCOL === "aerodrome" ? "velodrome" : "aerodrome"];
