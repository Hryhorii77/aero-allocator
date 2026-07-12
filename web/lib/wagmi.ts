import { createConfig, http } from "wagmi";
import { base } from "wagmi/chains";
import { coinbaseWallet, injected } from "wagmi/connectors";

export const wagmiConfig = createConfig({
  chains: [base],
  connectors: [injected(), coinbaseWallet({ appName: "Aero Allocator" })],
  transports: {
    [base.id]: http("https://base-rpc.publicnode.com"),
  },
  ssr: true,
});
