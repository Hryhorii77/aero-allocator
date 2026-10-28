import { DISPLAY_PRESET } from "./protocol";

// Which node the server reads Base through. RPC_URL always wins when set (BASE_RPC_URL is the older name for it); otherwise a public node.
// RPC_URL_FALLBACK is a second, independently operated node a viem fallback transport switches to if the first is down, not just rate-limited,
// so even a zero-config deployment has some redundancy. Server-only: these read process.env.
export const RPC_URL = process.env.RPC_URL ?? process.env.BASE_RPC_URL ?? DISPLAY_PRESET.defaultRpcUrl;
export const RPC_URL_FALLBACK = process.env.RPC_URL_FALLBACK ?? DISPLAY_PRESET.fallbackRpcUrl;
