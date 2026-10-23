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
  /** Seconds per block (average). */
  blockSec: number;
  /**
   * Whether fee pace is measured here. It needs event logs, which public nodes serve only ~10,000 blocks back, so a chain with
   * very short blocks (Arbitrum, Robinhood) covers minutes, and Ink's node refuses 5,000-block queries.
   */
  feeLogs: boolean;
}

export const AERO_CHAINS: AeroChain[] = [
  { id: 8453, key: "base", name: "Base", chain: base, rpcs: [], registry: "0x7b2A2c12dC5Ea2a31455952a05031C3E4BB28F3E", llama: "base", blockSec: 2, feeLogs: true },
  { id: 1, key: "ethereum", name: "Ethereum", chain: mainnet, rpcs: ["https://ethereum-rpc.publicnode.com", "https://ethereum.reth.rs/rpc"], registry: "0xdd1705e23762F4D6e44D8C31BD8Ea80c54612239", llama: "ethereum", blockSec: 12, feeLogs: true },
  { id: 10, key: "optimism", name: "OP", chain: optimism, rpcs: ["https://optimism-rpc.publicnode.com", "https://mainnet.optimism.io"], registry: "0xb6F9705A631CC1C0E8570FFde48882C95E2Df408", llama: "optimism", blockSec: 2, feeLogs: true },
  { id: 42161, key: "arbitrum", name: "Arbitrum", chain: arbitrum, rpcs: ["https://arbitrum-one-rpc.publicnode.com", "https://arb1.arbitrum.io/rpc"], registry: "0x9E635b2c689fC52201DF7eF1C9FA607c2F58f666", llama: "arbitrum", blockSec: 0.25, feeLogs: false },
  { id: 57073, key: "ink", name: "Ink", chain: ink, rpcs: ["https://rpc-gel.inkonchain.com"], registry: "0xdd1705e23762F4D6e44D8C31BD8Ea80c54612239", llama: "ink", blockSec: 1, feeLogs: false },
  { id: 4663, key: "robinhood", name: "Robinhood Chain", chain: robinhood, rpcs: ["https://rpc.mainnet.chain.robinhood.com"], registry: "0xdd1705e23762F4D6e44D8C31BD8Ea80c54612239", llama: "robinhood", blockSec: 0.1, feeLogs: false },
];

export const BASE_CHAIN = AERO_CHAINS[0];

export function chainById(id: number): AeroChain | undefined {
  return AERO_CHAINS.find((c) => c.id === id);
}
