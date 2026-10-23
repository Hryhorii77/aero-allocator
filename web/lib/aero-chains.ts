import { arbitrum, base, ink, mainnet, optimism, robinhood } from "viem/chains";
import type { Address, Chain } from "viem";

// Aero's leaf deployments, from Dromos-Labs/metadex-public deployment-addresses/leaf-<chain>.json (read
// 2026-10-23). The leaf voter has the same address everywhere; each chain has its own FactoryRegistry. Arc (5042) is
// left out: its public RPC did not answer from here, so its ~7 gauges are not read.
export interface AeroChain {
  id: number;
  key: string;
  name: string;
  chain: Chain;
  /** Public RPCs, tried in order. */
  rpcs: string[];
  registry: Address;
  /** DefiLlama coins-API chain slug. */
  llama: string;
  /** Seconds per block (average; measured over an hour on 2026-10-23, since Arbitrum runs slower than its nominal 0.25 s). */
  blockSec: number;
  /** Whether fee pace is measured here (from the stored record of NotifyFeesAmount events). */
  feeLogs: boolean;
  /**
   * Event-log reads need a node that serves deep history and ranges of thousands of blocks, which not every public node does
   * (publicnode refuses non-recent Arbitrum logs, Ink's default node caps queries at 1,000 blocks). These override the defaults
   * (the chain's `rpcs`, 10,000-block queries over 5 addresses, a ~9,500-block catch-up) where a better node was found.
   */
  logRpcs?: string[];
  /** Blocks per log query. */
  logSpan?: number;
  /** Fee contracts per log query. */
  logAddresses?: number;
  /** How far back a first run or a long gap reaches, in hours. */
  backfillHours?: number;
}

/** Blocks a first run or a long gap reaches back on this chain. */
export function lookbackBlocks(cfg: AeroChain, fallback: bigint): bigint {
  return cfg.backfillHours ? BigInt(Math.round((cfg.backfillHours * 3600) / cfg.blockSec)) : fallback;
}

export const AERO_CHAINS: AeroChain[] = [
  { id: 8453, key: "base", name: "Base", chain: base, rpcs: [], registry: "0x7b2A2c12dC5Ea2a31455952a05031C3E4BB28F3E", llama: "base", blockSec: 2, feeLogs: true },
  { id: 1, key: "ethereum", name: "Ethereum", chain: mainnet, rpcs: ["https://ethereum-rpc.publicnode.com", "https://ethereum.reth.rs/rpc"], registry: "0xdd1705e23762F4D6e44D8C31BD8Ea80c54612239", llama: "ethereum", blockSec: 12, feeLogs: true },
  { id: 10, key: "optimism", name: "OP", chain: optimism, rpcs: ["https://optimism-rpc.publicnode.com", "https://mainnet.optimism.io"], registry: "0xb6F9705A631CC1C0E8570FFde48882C95E2Df408", llama: "optimism", blockSec: 2, feeLogs: true },
  { id: 42161, key: "arbitrum", name: "Arbitrum", chain: arbitrum, rpcs: ["https://arbitrum-one-rpc.publicnode.com", "https://arb1.arbitrum.io/rpc"], registry: "0x9E635b2c689fC52201DF7eF1C9FA607c2F58f666", llama: "arbitrum", blockSec: 0.295, feeLogs: true, logRpcs: ["https://arb1.arbitrum.io/rpc"], logSpan: 9_000, logAddresses: 15, backfillHours: 24 },
  { id: 57073, key: "ink", name: "Ink", chain: ink, rpcs: ["https://rpc-gel.inkonchain.com"], registry: "0xdd1705e23762F4D6e44D8C31BD8Ea80c54612239", llama: "ink", blockSec: 1, feeLogs: true, logRpcs: ["https://rpc-qnd.inkonchain.com"], logSpan: 9_000, logAddresses: 5, backfillHours: 24 },
  { id: 4663, key: "robinhood", name: "Robinhood Chain", chain: robinhood, rpcs: ["https://rpc.mainnet.chain.robinhood.com"], registry: "0xdd1705e23762F4D6e44D8C31BD8Ea80c54612239", llama: "robinhood", blockSec: 0.104, feeLogs: true, logSpan: 50_000, logAddresses: 20, backfillHours: 24 },
];

export const BASE_CHAIN = AERO_CHAINS[0];

export function chainById(id: number): AeroChain | undefined {
  return AERO_CHAINS.find((c) => c.id === id);
}
