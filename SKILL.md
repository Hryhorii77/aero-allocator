---
name: aero-allocator
description: "Where an amount of sAERO earns the most on Aero (the merged Aerodrome and Velodrome), a sAERO position's stay / switch / allocate advice, and the unsigned allocate() transaction. Free read APIs plus three pay-per-call x402 endpoints (USDC on Base). Non-custodial: never holds keys, signs or sends. Estimates, not financial advice. Also an MCP server (npx aeroallocator-mcp) over the free reads."
metadata:
  emoji: ✈️
  homepage: https://aeroallocator.app
  category: defi-analytics
  chain: base
---

# Aero Allocator

Aero replaced weekly veAERO voting with continuous sAERO allocation on 2026-10-22. This project answers one question for a person or an agent: **which Aero gauges pay the most per day for a given amount of sAERO, and what should this position do?** Site: https://aeroallocator.app. Machine-readable descriptions: https://aeroallocator.app/llms.txt (plain text) and https://aeroallocator.app/openapi.json (OpenAPI 3.1, including the 402 behaviour of the paid routes).

Everything is read-only or unsigned. The site and APIs never hold keys, sign or send a transaction; the allocate flow signs in the user's own wallet, and the paid `allocate-plan` call returns calldata for the owner to sign. Amounts are sAERO **voting power**, as Aero shows them, and APR is per unit of power (so it is lower on staked AERO for a lock shorter than the maximum).

## Free reads (no payment, rate limited)

`GET https://aeroallocator.app/…`

- `/api/gauges?chain=8453` — every Aero gauge on a chain with weight, caps and incentives per week (chains: 8453 Base, 1 Ethereum, 10 OP, 42161 Arbitrum, 57073 Ink, 4663 Robinhood Chain, 5042 Arc). The Base list also carries `cooldownSec`, the live wait between allocations of one position.
- `/api/gauge-fees?chain=8453` — estimated fees per day per gauge from on-chain fee releases, with `windowHours` of history, a `steady` count and, when the recent pace is a burst far above the gauge's usual level, `spike`.
- `/api/gauge-history?chain=8453&gauge=0x…` — one gauge's fees per 6 hours, its weight snapshots and a 90-day `daily` record.
- `/api/top-gauges?chain=8453&amount=10000&limit=10` — the page's table as data: the gauges ranked by what the amount earns per day in each, with the low case, pace, steadiness and incentive-end notes. `chain=all` ranks every chain against its own fees and merges them (each row carries its `chainId`); the ETH to reach a chain other than Base is not counted there, `all-chains-split` weighs it.
- `/api/gauge-flows?chain=8453` — which gauges are gaining or losing share of the allocation weight, and which just got incentives.
- `/api/all-chains-split?amount=100000&days=30` — the best split over every chain, after the ETH each extra chain costs.
- `/api/allocation-fee?chain=10&gauges=2` — the ETH cost on Base of sending power to another chain.
- `/api/track-record` — the site's own record: each day's recommended split for 10,000 sAERO on Base, logged before the fact, against what those gauges paid two days later (results after 14 checked days).

## Paid (x402, USDC on Base, settled only after a successful answer)

A request with no payment gets HTTP 402 with the price and payout address; pay with any x402 client and retry. No account, no API key. A call that is rejected (400/404/422) is never charged. All three are listed in Coinbase's x402 Bazaar (and so agentic.market): `position` and `allocate-plan` since their first settled payments on 2026-10-26, `cross-chain-plan` since its first on 2026-10-28; search it for "sAERO position" or "sAERO allocate transaction", or use the URLs here and in llms.txt.

**`GET /api/v1/position?tokenId=<id>` or `?address=0x…` ($0.05) — where does this sAERO position stand?**
Power, lock, idle vs allocated power, when it can next be re-allocated, what it earns per day now versus the best split of Base gauges for its own size (fees plus incentives, after its own dilution), and a `stay` / `switch` / `allocate` / `unknown` recommendation. A switch is only recommended when it beats staying by 5% and $0.05/day and rests on at least 6 hours of fee history.

**`GET /api/v1/allocate-plan?tokenId=<id>&maxGauges=<1-6>` ($0.10) — the transaction to do it.**
The unsigned `allocate()` call (`transaction.to/data/value`, chain 8453) for the best split of Base gauges, already simulated as the owner (`simulation.ok` or the plain reason it would be rejected), with `cooldown`, expected USD/day versus now, and `warnings`. Sign and send it from `sendFrom`. Base only.

**`GET /api/v1/cross-chain-plan?tokenId=<id>&chains=5042:30,10:20` ($0.25) — the same, across chains.**
Ordered unsigned `allocate()` calls that spread the position over several chains: the best split over every chain after the one-off ETH each extra chain costs (leave `chains` out), or your percentages per chain (Base keeps the rest). Planned from the position's state on every chain, so it also returns power, moves it between chains and handles mixed positions. Each step has `transaction` (with the ETH in `value`), `canSendNow` and `blockedBy` (each chain has its own wait; power returned from another chain reaches Base minutes later), and step 1 is simulated. Send the steps in order, and call again between them. The first call can take about 20 s.

All three are estimates: fee figures are a recent pace (see `feeHistoryHours`, `confidence`), and every allocation restarts the wait (47 hours at launch, read live from the chain).

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

**Upgrading old veAERO:** `skills/veaero-to-saero-upgrade/` checks a wallet's old locks against Aero's migration contract (what each becomes, what blocks it) and prepares the unsigned approve + deposit transactions only after the owner confirms; read-only, irreversible, verified against Aero's public contracts and a fork of Base.

**Automating it:** the companion skill `skills/saero-allocator-automator/` is a playbook and two small scripts for an agent that re-allocates a position when it is worth it: fixed rules (wait over, real and steady gain, never a one-off fee burst), the plan checked before it is handed to the owner's wallet, and no signing in the skill.

## Example prompts

- "Which Aero gauges pay the most per day for 10,000 sAERO right now, and how steady is each one's fee pace?"
- "Across every Aero chain, which gauges pay the most for 10,000 sAERO, and is any other chain worth its ETH fee?"
- "Should sAERO position #15308 stay where it is or move? Show what staying costs per day."
- "Give me the unsigned allocate() transaction for the best split of position #15308 across at most 4 gauges." (the owner signs and sends it from their own wallet)

## Safety

- Read-only by construction: the APIs return data and unsigned calldata only.
- Fee figures are a recent pace, not a promise. A gauge whose pace is a one-off burst is marked `spike`, and its APR is best read as a range from its usual level up to the burst.
- Every allocation replaces the position's whole Base distribution and restarts the wait before the next change, so a small gain is not worth moving for.
- Not investment advice.

## MCP server

The same free reads as six MCP tools (`top_gauges`, which also takes `chain: "all"`, `best_split_all_chains`, `power_flows`, `gauge_history`, `allocation_fee`, `track_record`). Zero dependencies, stdio, Node 22+, no key, never signs:

```bash
claude mcp add aeroallocator -- npx -y aeroallocator-mcp
```

or `{ "mcpServers": { "aeroallocator": { "command": "npx", "args": ["-y", "aeroallocator-mcp"] } } }` in any MCP client. The weekly-vote MCP server this repo used to hold was removed on 2026-10-28 with the weekly vote itself (it is in git history).
