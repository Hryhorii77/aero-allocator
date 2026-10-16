import { createConfig, fallback, http } from "wagmi";
import { coinbaseWallet, injected } from "wagmi/connectors";
import { DISPLAY_PRESET } from "./protocol";
import { DATA_SUFFIX } from "./attribution";

export const wagmiConfig = createConfig({
  chains: [DISPLAY_PRESET.chain],
  connectors: [injected(), coinbaseWallet({ appName: `${DISPLAY_PRESET.displayName} Allocator` })],
  transports: {
    // Falls through on any RPC error, which matters: publicnode answers receipt lookups with an
    // error (token required), so confirmations would otherwise hang.
    [DISPLAY_PRESET.chain.id]: fallback([http(DISPLAY_PRESET.defaultRpcUrl), http(DISPLAY_PRESET.fallbackRpcUrl)]),
  },
  ssr: true,
  // ERC-8021 Builder Code attribution — see lib/attribution.ts. Client-level
  // (not per-call) so every wagmi-sent transaction is covered automatically,
  // including any future write beyond just castVote.
  dataSuffix: DATA_SUFFIX,
});
