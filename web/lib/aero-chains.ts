import { arbitrum, arc, base, ink, mainnet, optimism, robinhood } from "viem/chains";
import type { Address, Chain } from "viem";

// Aero's leaf deployments, from Dromos-Labs/metadex-public deployment-addresses/leaf-<chain>.json (read
// 2026-10-23). The leaf voter has the same address everywhere; each chain has its own FactoryRegistry. Arc (5042) was added
// 2026-10-28 once public nodes were found: Circle's own rpc.mainnet.arc.io refuses requests from here (Cloudflare 1009), so reads use
// publicnode, Tenderly's gateway and dRPC. Logs come from Tenderly's gateway only: 100,000 blocks per query and deep history, at about
// five requests a second. dRPC's free tier refuses log queries, publicnode only serves the latest 1,000 blocks, and thirdweb's gateway
// caps queries at 1,000 blocks and answers 429 after a few requests a second (a day of Arc history, 0.507 s a block, would be 170 queries).
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

// viem's Arc definition has no Multicall3 entry, but the standard contract is deployed there (code present at 0xcA11…CA11, 2026-10-28).
const arcChain = { ...arc, contracts: { ...arc.contracts, multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" as Address } } } as Chain;

export const AERO_CHAINS: AeroChain[] = [
  { id: 8453, key: "base", name: "Base", chain: base, rpcs: [], registry: "0x7b2A2c12dC5Ea2a31455952a05031C3E4BB28F3E", llama: "base", blockSec: 2, feeLogs: true },
  { id: 1, key: "ethereum", name: "Ethereum", chain: mainnet, rpcs: ["https://ethereum-rpc.publicnode.com", "https://ethereum.reth.rs/rpc"], registry: "0xdd1705e23762F4D6e44D8C31BD8Ea80c54612239", llama: "ethereum", blockSec: 12, feeLogs: true },
  { id: 10, key: "optimism", name: "OP", chain: optimism, rpcs: ["https://optimism-rpc.publicnode.com", "https://mainnet.optimism.io"], registry: "0xb6F9705A631CC1C0E8570FFde48882C95E2Df408", llama: "optimism", blockSec: 2, feeLogs: true },
  { id: 42161, key: "arbitrum", name: "Arbitrum", chain: arbitrum, rpcs: ["https://arbitrum-one-rpc.publicnode.com", "https://arb1.arbitrum.io/rpc"], registry: "0x9E635b2c689fC52201DF7eF1C9FA607c2F58f666", llama: "arbitrum", blockSec: 0.295, feeLogs: true, logRpcs: ["https://arb1.arbitrum.io/rpc"], logSpan: 9_000, logAddresses: 15, backfillHours: 24 },
  { id: 57073, key: "ink", name: "Ink", chain: ink, rpcs: ["https://rpc-gel.inkonchain.com"], registry: "0xdd1705e23762F4D6e44D8C31BD8Ea80c54612239", llama: "ink", blockSec: 1, feeLogs: true, logRpcs: ["https://rpc-qnd.inkonchain.com"], logSpan: 9_000, logAddresses: 5, backfillHours: 24 },
  { id: 4663, key: "robinhood", name: "Robinhood Chain", chain: robinhood, rpcs: ["https://rpc.mainnet.chain.robinhood.com"], registry: "0xdd1705e23762F4D6e44D8C31BD8Ea80c54612239", llama: "robinhood", blockSec: 0.104, feeLogs: true, logSpan: 50_000, logAddresses: 20, backfillHours: 24 },
  { id: 5042, key: "arc", name: "Arc", chain: arcChain, rpcs: ["https://arc-rpc.publicnode.com", "https://arc.gateway.tenderly.co", "https://arc.drpc.org"], registry: "0xCe44907DC45D3BFa3f5f6035B0e6E8B22D780A42", llama: "arc", blockSec: 0.507, feeLogs: true, logRpcs: ["https://arc.gateway.tenderly.co"], logSpan: 50_000, logAddresses: 10, backfillHours: 24 },
];

export const BASE_CHAIN = AERO_CHAINS[0];

export function chainById(id: number): AeroChain | undefined {
  return AERO_CHAINS.find((c) => c.id === id);
}
