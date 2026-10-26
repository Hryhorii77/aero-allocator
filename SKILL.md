---
name: aero-allocator
description: Where an amount of sAERO earns the most on Aero (the merged Aerodrome and Velodrome), a sAERO position's stay / switch / allocate advice, and the unsigned allocate() transaction. Free read APIs plus two pay-per-call x402 endpoints (USDC on Base). Non-custodial: never holds keys, signs or sends. Estimates, not financial advice. A legacy MCP server for the retired weekly veAERO vote is kept in the repo.
metadata:
  emoji: ✈️
  homepage: https://aeroallocator.app
  category: defi-analytics
  chain: base
---

# Aero Allocator

Aero replaced weekly veAERO voting with continuous sAERO allocation on 2026-10-22. This project answers one question for a person or an agent: **which Aero gauges pay the most per day for a given amount of sAERO, and what should this position do?** Site: https://aeroallocator.app. Machine-readable description: https://aeroallocator.app/llms.txt.

Everything is read-only or unsigned. The site and APIs never hold keys, sign or send a transaction; the allocate flow signs in the user's own wallet, and the paid `allocate-plan` call returns calldata for the owner to sign. Amounts are sAERO **voting power**, as Aero shows them, and APR is per unit of power (so it is lower on staked AERO for a lock shorter than the maximum).

## Free reads (no payment, rate limited)

`GET https://aeroallocator.app/…`

- `/api/gauges?chain=8453` — every Aero gauge on a chain with weight, caps and incentives per week (chains: 8453 Base, 1 Ethereum, 10 OP, 42161 Arbitrum, 57073 Ink, 4663 Robinhood Chain). The Base list also carries `cooldownSec`, the live wait between allocations of one position.
- `/api/gauge-fees?chain=8453` — estimated fees per day per gauge from on-chain fee releases, with `windowHours` of history, a `steady` count and, when the recent pace is a burst far above the gauge's usual level, `spike`.
- `/api/gauge-history?chain=8453&gauge=0x…` — one gauge's fees per 6 hours, its weight snapshots and a 90-day `daily` record.
- `/api/gauge-flows?chain=8453` — which gauges are gaining or losing share of the allocation weight, and which just got incentives.
- `/api/allocation-fee?chain=10&gauges=2` — the ETH cost on Base of sending power to another chain.

## Paid (x402, USDC on Base, settled only after a successful answer)

A request with no payment gets HTTP 402 with the price and payout address; pay with any x402 client and retry. No account, no API key. A call that is rejected (400/404/422) is never charged. Both declare x402 Bazaar discovery metadata, so Coinbase's catalog (and agentic.market) can list them once a first paid call has settled; until then, use the URLs here and in llms.txt.

**`GET /api/v1/position?tokenId=<id>` or `?address=0x…` ($0.05) — where does this sAERO position stand?**
Power, lock, idle vs allocated power, when it can next be re-allocated, what it earns per day now versus the best split of Base gauges for its own size (fees plus incentives, after its own dilution), and a `stay` / `switch` / `allocate` / `unknown` recommendation. A switch is only recommended when it beats staying by 5% and $0.05/day and rests on at least 6 hours of fee history.

**`GET /api/v1/allocate-plan?tokenId=<id>&maxGauges=<1-6>` ($0.10) — the transaction to do it.**
The unsigned `allocate()` call (`transaction.to/data/value`, chain 8453) for the best split of Base gauges, already simulated as the owner (`simulation.ok` or the plain reason it would be rejected), with `cooldown`, expected USD/day versus now, and `warnings`. Sign and send it from `sendFrom`. Base only.

Both are estimates: fee figures are a recent pace (see `feeHistoryHours`, `confidence`), and every allocation restarts the wait (47 hours at launch, read live from the chain).

```ts
import { wrapFetchWithPaymentFromConfig } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm";
import { privateKeyToAccount } from "viem/accounts";

const account = privateKeyToAccount("0xYourPrivateKey");
const fetchWithPayment = wrapFetchWithPaymentFromConfig(fetch, {
  schemes: [{ network: "eip155:8453", client: new ExactEvmScheme(account) }],
});

const res = await fetchWithPayment("https://aeroallocator.app/api/v1/position?tokenId=15308");
const data = await res.json();
```

## Example prompts

- "Which Aero gauges pay the most per day for 10,000 sAERO right now, and how steady is each one's fee pace?"
- "Should sAERO position #15308 stay where it is or move? Show what staying costs per day."
- "Give me the unsigned allocate() transaction for the best split of position #15308 across at most 4 gauges." (the owner signs and sends it from their own wallet)

## Safety

- Read-only by construction: the APIs return data and unsigned calldata only.
- Fee figures are a recent pace, not a promise. A gauge whose pace is a one-off burst is marked `spike`, and its APR is best read as a range from its usual level up to the burst.
- Every allocation replaces the position's whole Base distribution and restarts the wait before the next change, so a small gain is not worth moving for.
- Not investment advice.

## Legacy: weekly-vote MCP server (kept, not the live product)

The repo also contains the MCP server and engine built for the weekly veAERO vote on Aerodrome (Base) / Velodrome (Optimism), which Aero retired on 2026-10-22. Its tools (`predict_demand`, `recommend_allocation`, `prepare_vote_calldata`, `scan_pools`, `pool_history`, and the bribe and LP tools) still run, but `prepare_vote_calldata` targets the classic `Voter.vote()` that no longer exists, so do not use it to act on Aero. It has no sAERO tools. The web app imports only its `config` and `prices` modules. See the README for its tools and the forecast model.

```bash
git clone https://github.com/Hryhorii77/aero-allocator && cd aero-allocator && npm install
claude mcp add aero-allocator -- npx tsx $(pwd)/src/index.ts
```
