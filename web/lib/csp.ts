/**
 * The site's Content Security Policy, sent in REPORT-ONLY mode: the browser tells /api/csp-report what it would have blocked and
 * blocks nothing, so a missing host can't break wallet connecting. Once the reports stay quiet for a few days it can be enforced.
 *
 * Be honest about what this policy buys: Next's own bootstrap scripts and the theme script are inline, so `script-src` still has to
 * allow 'unsafe-inline' until nonces are added; what it does restrict is where scripts, connections, frames and plugins may come from,
 * who may frame the site, and what <base> and forms may point at. `lib/csp.test.ts` fails when a chain's RPC host is not covered.
 *
 * Found by running it (2026-10-30, production build, connect dialog + WalletConnect window): `fonts.reown.com` needed a `font-src` entry
 * (added), and opening WalletConnect's window runs an `eval` (reported as `script-src eval`, from the wallet library, not our code).
 * Enforcing this policy as it stands would block that eval; that needs either 'unsafe-eval' (a real weakening) or a wallet library that
 * doesn't use it, so the policy stays report-only until that is decided.
 */
export const CSP_REPORT_PATH = "/api/csp-report";

/** Nodes the browser reads from directly (positions on each chain, the Base wagmi transport). Keep in step with `aero-chains.ts` and `protocol.ts`; the test checks it. */
export const RPC_ORIGINS = [
  "https://base-rpc.publicnode.com",
  "https://mainnet.base.org",
  "https://ethereum-rpc.publicnode.com",
  "https://ethereum.reth.rs",
  "https://optimism-rpc.publicnode.com",
  "https://mainnet.optimism.io",
  "https://arbitrum-one-rpc.publicnode.com",
  "https://arb1.arbitrum.io",
  "https://rpc-gel.inkonchain.com",
  "https://rpc-qnd.inkonchain.com",
  "https://rpc.mainnet.chain.robinhood.com",
  "https://arc-rpc.publicnode.com",
  "https://arc.gateway.tenderly.co",
  "https://arc.drpc.org",
];

// WalletConnect / Reown (relay, verify, wallet registry and logos) and Coinbase Wallet's SDK, loaded only when a visitor connects with them.
const WALLETCONNECT = ["https://*.walletconnect.com", "https://*.walletconnect.org", "wss://*.walletconnect.com", "wss://*.walletconnect.org", "https://*.reown.com", "wss://*.reown.com", "https://*.web3modal.org"];
const COINBASE = ["https://*.coinbase.com", "wss://*.coinbase.com"];

export function cspDirectives(): Record<string, string[]> {
  return {
    "default-src": ["'self'"],
    // 'unsafe-inline': Next's bootstrap and the theme script. 'wasm-unsafe-eval': some wallet SDKs compile WebAssembly.
    "script-src": ["'self'", "'unsafe-inline'", "'wasm-unsafe-eval'"],
    "style-src": ["'self'", "'unsafe-inline'"],
    // EIP-6963 wallet icons arrive as data: URIs; the connect window shows wallet logos from https hosts.
    "img-src": ["'self'", "data:", "blob:", "https:"],
    // WalletConnect's connect window loads its own typeface from fonts.reown.com (found by running it under this policy).
    "font-src": ["'self'", "data:", "https://fonts.reown.com"],
    "connect-src": ["'self'", ...RPC_ORIGINS, ...WALLETCONNECT, ...COINBASE],
    "frame-src": ["https://*.walletconnect.com", "https://*.walletconnect.org", ...COINBASE.filter((s) => s.startsWith("https"))],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "frame-ancestors": ["'none'"],
    "report-uri": [CSP_REPORT_PATH],
  };
}

export function cspReportOnly(): string {
  return Object.entries(cspDirectives())
    .map(([k, v]) => `${k} ${v.join(" ")}`)
    .join("; ");
}
