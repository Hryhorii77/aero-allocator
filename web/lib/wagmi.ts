import { createConfig, fallback, http } from "wagmi";
import { injected } from "wagmi/connectors/injected";
import { lazyConnector } from "./lazy-connector";
import { DISPLAY_PRESET } from "./protocol";
import { DATA_SUFFIX } from "./attribution";

// A free Reown (WalletConnect) Cloud project id, public by design. It is what lets a phone's
// normal browser (no extensions) connect to a wallet app. Without one the connector is left out
// entirely: wagmi opens its relay socket when the config is built, and with no real id that
// socket churns and hangs the tab (seen in afterbook, which has the same setup).
const WALLETCONNECT_PROJECT_ID = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;

export const wagmiConfig = createConfig({
  chains: [DISPLAY_PRESET.chain],
  connectors: [
    injected(),
    // Coinbase's and WalletConnect's SDKs load only when used (see lazy-connector.ts): they were about half of what every visitor downloaded.
    // Import each from its own entry point: the barrel ("wagmi/connectors") also pulls in the Base Account connector, whose dependencies fail the build.
    lazyConnector({ id: "coinbaseWalletSDK", name: "Coinbase Wallet", type: "coinbaseWallet", rdns: "com.coinbase.wallet" }, async () => {
      const { coinbaseWallet } = await import("wagmi/connectors/coinbaseWallet");
      return coinbaseWallet({ appName: DISPLAY_PRESET.appName });
    }),
    ...(WALLETCONNECT_PROJECT_ID
      ? [
          lazyConnector({ id: "walletConnect", name: "WalletConnect", type: "walletConnect" }, async () => {
            const { walletConnect } = await import("wagmi/connectors/walletConnect");
            return walletConnect({
              projectId: WALLETCONNECT_PROJECT_ID,
              showQrModal: true,
              // Listed first in WalletConnect's own wallet window, before its search over hundreds
              // of others (ids from WalletConnect's registry, same list as afterbook.app).
              qrModalOptions: {
                explorerRecommendedWalletIds: [
                  "c57ca95b47569778a828d19178114f4db188b89b763c899ba0be274e97267d96", // MetaMask
                  "18388be9ac2d02726dbac9777c96efaac06d744b2f6d580fccdd4127a6d01fd1", // Rabby
                  "fd20dc426fb37566d803205b19bbc1d4096b248ac04548e3cfb6b3a38bd033aa", // Base
                  "4622a2b2d6af1c9844944291e5e7351a6aa24cd7b23099efac1b2fd875da31a0", // Trust Wallet
                  "1ae92b26df02f0abca6304df07debccd18262fdf5fe82daa81593582dac9a369", // Rainbow
                  "971e689d0a5be527bac79629b4ee9b925e82208e5168b733496a09c0faed0709", // OKX Wallet
                  "ecc4036f814562b41a5268adc86270fba1365471402006302e70169465b7ac18", // Zerion
                ],
              },
            });
          }),
        ]
      : []),
  ],
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
