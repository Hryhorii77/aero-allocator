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
  /** Base URL of the protocol's own app — its /vote and /liquidity pages both
   * accept `?query=<pool address>` and pre-filter to that exact pool
   * (confirmed live against aerodrome.finance; velodrome.finance is the
   * same frontend lineage so assumed to match, not independently verified). */
  appUrl: string;
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
    appUrl: "https://aerodrome.finance",
  },
  velodrome: {
    protocol: "velodrome",
    displayName: "Velodrome",
    tokenSymbol: "VELO",
    veTokenSymbol: "veVELO",
    networkName: "Optimism",
    chain: optimism,
    defaultRpcUrl: "https://mainnet.optimism.io",
    appUrl: "https://velodrome.finance",
  },
};

export const DISPLAY_PRESET = DISPLAY[PROTOCOL];

// No SIBLING_PRESET / cross-deployment switcher any more. The hosted
// Velodrome deployment is retired: measured against Aerodrome on the same
// day it ran 53 pools to 276, $51k of last-epoch fees to $1.55M, and $1.88
// of voter ROI per 10k ve to $85.52 — a market too small to justify a second
// public surface to keep current, and the switcher was sending people from
// the maintained product to a silently-stale one.
//
// The velodrome preset itself stays, and stays supported: AERO_PROTOCOL=
// velodrome still runs the whole stack against Optimism for anyone
// self-hosting. Keeping it is also what keeps this abstraction honest — a
// second real deployment target is the thing that proves the engine isn't
// quietly Base-specific, which is what will make adding Aero (its own
// addresses, its own chain) a preset rather than a refactor.
