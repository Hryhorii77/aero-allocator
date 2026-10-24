/**
 * One structured log line per paid request served, visible in Vercel's Logs tab. It fires when the handler is about to answer, which
 * is just before settlement (withX402 settles after the handler returns and exposes no hook), so it is a strong proxy for "paid",
 * not proof: the chain is the revenue ledger (every settled call is a USDC transfer to X402_PAYTO_ADDRESS on Base).
 */
export function logX402Usage(route: string, priceUsd: number, params: Record<string, string | number>): void {
  console.log(JSON.stringify({ level: "info", event: "x402_request_served", route, priceUsd, params }));
}
