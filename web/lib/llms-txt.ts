import { ALLOCATE_PLAN_PRICE_USD } from "./v1-allocate-plan";
import { POSITION_PRICE_USD } from "./v1-position";

/** What an agent needs to use this site: the free reads, the two paid calls, and how paying works. Plain text, served at /llms.txt. */
export function llmsTxt(siteUrl: string): string {
  const usd = (n: number) => `$${n.toFixed(2)}`;
  return `# Aero Allocator

> Where an amount of sAERO earns the most on Aero (the merged Aerodrome and Velodrome), your sAERO positions, and the unsigned transaction to allocate them. Non-custodial: we never hold keys, sign or send anything. Estimates, not financial advice.

Site: ${siteUrl}
Chain: Base (8453). Amounts are sAERO voting power.

## Free (no payment, rate limited)

- GET ${siteUrl}/api/gauges?chain=8453 : every Aero gauge on a chain with its weight, caps and incentives. Chains: 8453 Base, 1 Ethereum, 10 OP, 42161 Arbitrum, 57073 Ink, 4663 Robinhood Chain.
- GET ${siteUrl}/api/gauge-fees?chain=8453 : estimated fees per day per gauge, measured from on-chain fee releases, with the hours of history behind each figure.
- GET ${siteUrl}/api/gauge-history?chain=8453&gauge=0x... : one gauge's fees released per 6 hours, its weight snapshots and how steady its payouts were.
- GET ${siteUrl}/api/gauge-flows?chain=8453 : how each gauge's share of the allocation weight moved over the last day and which gauges just started receiving incentives (empty until two hours of snapshots exist).
- GET ${siteUrl}/api/allocation-fee?chain=10&gauges=2 : ETH cost on Base of sending power to another chain (read from Aero's own message adapter).

## Paid (x402: USDC on Base, settled only after a successful answer)

A request with no payment gets HTTP 402 with the price and our payout address. Pay with any x402 client, then retry. A request that is rejected (400, 404, 422) is never charged. These need something the free reads can't give: a chain read keyed to one position, or ready-made calldata.

- GET ${siteUrl}/api/v1/position?tokenId=<id> or ?address=0x… (${usd(POSITION_PRICE_USD)}) : a position's power, lock, idle vs allocated power, the 47-hour re-allocation wait, what it earns per day now versus the best split of gauges for its own size, and a stay / switch / allocate recommendation. A switch is only recommended on at least 6 hours of fee history.
- GET ${siteUrl}/api/v1/allocate-plan?tokenId=<id>&maxGauges=<1-6> (${usd(ALLOCATE_PLAN_PRICE_USD)}) : the unsigned allocate() transaction (to, data, value) for the best split of Base gauges, already simulated as the owner, with the cooldown and warnings. Sign and send it from the owner's wallet. Base only.

## Limits

- Fee figures are a recent pace, not a promise; see feeHistoryHours and confidence in each response.
- Every allocation restarts a 47-hour wait before the next change.
- Sending power to other chains is not built.

Source: https://github.com/Hryhorii77/aero-allocator
`;
}
