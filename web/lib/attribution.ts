import { Attribution } from "ox/erc8021";

// Registered via POST https://api.base.dev/v1/agents/builder-codes for
// 0x9b3F205E43dc9FcC1cc2Fe6d9dCD0357769A6Bae — the same wallet that already
// receives x402 payments (X402_PAYTO_ADDRESS), so one address represents
// this project's identity rather than managing a second one. Re-running
// that registration for the same wallet always returns this same code
// (idempotent, per Base's docs), so it's safe to re-register if this ever
// needs rotating.
export const BUILDER_CODE = "bc_4vi91928";

/**
 * ERC-8021 attribution suffix — a fixed 16+ byte trailer appended to the end
 * of transaction calldata so Base can attribute vote transactions cast
 * through this dashboard back to Aero Allocator (see lib/wagmi.ts, which
 * appends this to every wagmi-sent transaction, and wallet.tsx's no-wallet
 * calldata-copy path, which appends it manually since that path never goes
 * through a wagmi client). Purely additive: Voter.vote()'s own ABI decoding
 * only reads the bytes it expects and ignores anything appended after —
 * this cannot alter what the vote transaction actually does onchain.
 */
export const DATA_SUFFIX = Attribution.toDataSuffix({ codes: [BUILDER_CODE] });
