// Client-safe display values for the one protocol this app serves: Aero on Base (Aerodrome and Velodrome merged into Aero on
// 2026-10-22; Optimism is now one of its leaf chains, see aero-chains.ts). No "use client" here — these are plain values, safe
// to import from both server (layout.tsx metadata) and client code.
//
// Only display strings and the (public, non-secret) chain object live here. The contract addresses the wallet flow signs against
// are in saero.ts.
import { base, type Chain } from "wagmi/chains";

export type Protocol = "aerodrome";

export const PROTOCOL: Protocol = "aerodrome";

interface ProtocolDisplay {
  protocol: Protocol;
  displayName: string;
  /** The product name shown in the header, titles and share card ("Aero Allocator"). */
  appName: string;
  tokenSymbol: string;
  veTokenSymbol: string;
  networkName: string;
  chain: Chain;
  defaultRpcUrl: string;
  /** Second public RPC. publicnode refuses eth_getTransactionReceipt without a token, so receipt
   * lookups (tx confirmation) need somewhere else to go. */
  fallbackRpcUrl: string;
  /** Base URL of the protocol's own app. */
  appUrl: string;
}

export const DISPLAY_PRESET: ProtocolDisplay = {
  protocol: "aerodrome",
  displayName: "Aerodrome",
  appName: "Aero Allocator",
  tokenSymbol: "AERO",
  veTokenSymbol: "veAERO",
  networkName: "Base",
  chain: base,
  defaultRpcUrl: "https://base-rpc.publicnode.com",
  fallbackRpcUrl: "https://mainnet.base.org",
  appUrl: "https://aerodrome.finance",
};
