import { createConfig, http } from "wagmi";
import { coinbaseWallet, injected } from "wagmi/connectors";
import { DISPLAY_PRESET } from "./protocol";

export const wagmiConfig = createConfig({
  chains: [DISPLAY_PRESET.chain],
  connectors: [injected(), coinbaseWallet({ appName: `${DISPLAY_PRESET.displayName} Allocator` })],
  transports: {
    [DISPLAY_PRESET.chain.id]: http(DISPLAY_PRESET.defaultRpcUrl),
  },
  ssr: true,
});
