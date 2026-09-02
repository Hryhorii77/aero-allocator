import { PROTOCOL } from "aero-allocator/config";

// $0.05 fixed price for /api/v1/forecast — see route.ts's routeConfig.accepts.
const PRICE_USD = 0.05;

/**
 * Structured usage log for the paid /api/v1/forecast endpoint, visible in
 * Vercel's Logs tab (same infra as lib/api-error.ts's error logging — no
 * new account/service).
 *
 * IMPORTANT: this fires once payment has been VERIFIED and the route
 * handler is about to serve its response — not once settlement (the actual
 * on-chain USDC transfer) has completed. withX402 (@x402/next) settles
 * strictly *after* the wrapped handler returns, entirely inside its own
 * code, and exposes no hook for the result to reach here — confirmed by
 * reading its source (web/app/api/v1/forecast/route.ts's comments have
 * more detail). So "request served" is a strong proxy for "payment
 * settled," not a guarantee: the authoritative revenue ledger is the chain
 * itself — every settled payment is a real USDC transfer to
 * X402_PAYTO_ADDRESS on Base, auditable via Basescan or any Base RPC.
 * Reconcile against that for exact figures; use this log for traffic/usage
 * visibility (is anyone calling this at all, and with what params).
 *
 * The inverse also holds by design, not by accident: a request that never
 * reaches here (validation failure, thrown error) never got billed either
 * — withX402 explicitly cancels settlement when the wrapped handler
 * throws, so this log and "was this call charged" stay in lockstep.
 */
export function logX402Usage(params: { refresh: boolean; votingPower: number }): void {
  console.log(
    JSON.stringify({
      level: "info",
      event: "x402_request_served",
      route: "v1/forecast",
      protocol: PROTOCOL,
      priceUsd: PRICE_USD,
      refresh: params.refresh,
      votingPower: params.votingPower,
    }),
  );
}
