import { PROTOCOL } from "aero-allocator/config";

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
export function logX402Usage(params: {
  /** Which paid endpoint served this, e.g. "v1/forecast" or "v1/position". */
  route: string;
  /** That route's own price — passed in, not assumed, so the two can diverge. */
  priceUsd: number;
  refresh: boolean;
  /** Only the endpoints sized for a voting-power amount have one; others (e.g. v1/bribe-target) log what they were asked instead. */
  votingPower?: number;
  /** Free-form request params for endpoints that aren't keyed by voting power. */
  params?: Record<string, string | number>;
}): void {
  console.log(
    JSON.stringify({
      level: "info",
      event: "x402_request_served",
      route: params.route,
      protocol: PROTOCOL,
      priceUsd: params.priceUsd,
      refresh: params.refresh,
      votingPower: params.votingPower,
      params: params.params,
    }),
  );
}
