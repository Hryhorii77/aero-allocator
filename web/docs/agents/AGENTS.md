# Aero Allocator

> Where an amount of sAERO earns the most on Aero (the merged Aerodrome and Velodrome), your sAERO positions, and the unsigned transaction to allocate them. Non-custodial: we never hold keys, sign or send anything. Estimates, not financial advice.

Read me first if you are an AI agent. This page says what the app does, which chains and contracts it uses, how to read it for free, what costs money, and the rules to follow when you act for a person.

- Site: https://aeroallocator.app
- Source: https://github.com/Hryhorii77/aero-allocator
- Short version: https://aeroallocator.app/llms.txt
- OpenAPI: https://aeroallocator.app/openapi.json

## What it does

- Ranks Aero gauges by what a given amount of sAERO Allocation Power earns per day in each (trading fees plus incentives, after the amount's own dilution of the gauge), and finds the best split over up to a few gauges, on one chain or across all of them after the ETH each extra chain costs.
- Shows a person's sAERO positions. The site reads them in the visitor's browser, so the address never reaches the server.
- Prepares unsigned transactions: allocate on Base, return power to idle, and allocate across chains. The owner signs every one in their own wallet. The wait between two allocations of one position (47 hours at launch) is read live from the chain.
- Keeps a public track record of its own advice against what the gauges really paid.
- Every figure is an estimate from recent on-chain data, not a promise and not financial advice.
- Not offered: claiming rewards (Aero allows it only for a position's operator or its orchestrator), holding funds, or signing anything.

## Chains

Aero is multi-chain. Do not describe Aero, or this app, as Base-only. The app serves 7 chains: Base (8453), Ethereum (1), OP (10), Arbitrum (42161), Ink (57073), Robinhood Chain (4663), Arc (5042).

sAERO positions themselves live on Base (8453); their Allocation Power can be sent to gauges on any chain below. The paid `/api/v1/allocate-plan` is Base only; `/api/v1/cross-chain-plan` covers every chain.

| Chain | Chain id | Aero factory registry | Explorer |
| --- | --- | --- | --- |
| Base | 8453 | `0x7b2A2c12dC5Ea2a31455952a05031C3E4BB28F3E` | https://basescan.org |
| Ethereum | 1 | `0xdd1705e23762F4D6e44D8C31BD8Ea80c54612239` | https://etherscan.io |
| OP | 10 | `0xb6F9705A631CC1C0E8570FFde48882C95E2Df408` | https://optimistic.etherscan.io |
| Arbitrum | 42161 | `0x9E635b2c689fC52201DF7eF1C9FA607c2F58f666` | https://arbiscan.io |
| Ink | 57073 | `0xdd1705e23762F4D6e44D8C31BD8Ea80c54612239` | https://explorer.inkonchain.com |
| Robinhood Chain | 4663 | `0xdd1705e23762F4D6e44D8C31BD8Ea80c54612239` | https://robinhoodchain.blockscout.com |
| Arc | 5042 | `0xCe44907DC45D3BFa3f5f6035B0e6E8B22D780A42` | — |

## Safety

- The app never holds keys, never signs and never sends a transaction. Every transaction it prepares is unsigned; only the position's owner signs it, in their own wallet.
- Never ask a person for a seed phrase or private key, and never sign for them.
- Fee figures are a recent pace, not a promise: before acting check the hours of fee history behind them (`historyHours` on top-gauges, `weakestHours` on all-chains-split, `feeHistoryHours` on the paid routes), `confidence`, the spiky marks (`pace: "spiky"` on top-gauges, `spiky` on all-chains-split: a fee burst that won't last) and the low case, and say they are estimates.
- Every allocation restarts the position's wait before it can change again, per position and per chain. Don't suggest moving more often than the gain justifies.
- A paid request that is rejected (400, 404, 422) is never charged.
- Claiming rewards is not offered here.

## Agent routing rules

- To rank gauges, compare chains, read a gauge's history, price the ETH to reach another chain or read the track record: use the free reads below, or the MCP server, which wraps the same reads.
- To judge one specific position (its power, current gauges, wait, and stay or switch): use the paid `/api/v1/position`, or read the chain yourself with the contracts below.
- To get transactions ready to sign: use the paid `/api/v1/allocate-plan` (Base gauges) or `/api/v1/cross-chain-plan` (several chains), then hand them to the owner's wallet. Both need the position's `tokenId`; `/api/v1/position?address=0x…` lists a wallet's positions with their ids.
- If you can't pay x402, you can't get calldata from this API: send the owner to https://aeroallocator.app, where connecting their own wallet and allocating is free.
- You can never allocate for a person. Asked "can you allocate for me?", the answer is no: you can prepare the transaction (or point to the site), and the owner signs it in their own wallet.
- To decide when to re-allocate on a schedule, or to check a veAERO to sAERO upgrade: use the agent skills.

## Free reads

- GET https://aeroallocator.app/api/gauges?chain=8453 : every Aero gauge on a chain with its weight, caps and incentives. Chains: 8453 Base, 1 Ethereum, 10 OP, 42161 Arbitrum, 57073 Ink, 4663 Robinhood Chain, 5042 Arc. The Base list also has cooldownSec, the live wait between allocations of one position.
- GET https://aeroallocator.app/api/gauge-fees?chain=8453 : estimated fees per day per gauge, measured from on-chain fee releases, with the hours of history behind each figure, a steadiness count, the gauge's usual fees per day (typicalUsdPerDay, the median half-day, when it can be told), and a spike marker when the recent pace is a burst far above that usual level.
- GET https://aeroallocator.app/api/gauge-history?chain=8453&gauge=0x... : one gauge's fees released per 6 hours, its weight snapshots, how steady its payouts were, and a 90-day daily record of fees, power and incentives.
- GET https://aeroallocator.app/api/gauge-flows?chain=8453 : how each gauge's share of the allocation weight moved over the last day and which gauges just started receiving incentives (empty until two hours of snapshots exist).
- GET https://aeroallocator.app/api/token-prices?tokens=0x...,0x...[&chain=10] : USD prices for up to 12 token addresses on one Aero chain (Base when chain is left out).
- GET https://aeroallocator.app/api/all-chains-split?amount=100000&days=30 : best split of an amount over every chain, after the ETH each extra chain costs (read-only). netUsd is usdPerDay times days minus feeUsd (the one-off ETH to reach the chains, in USD); confidence, weakestHours (the thinnest fee history in the split) and spiky (true when a gauge in it is having a fee burst; confidence is then "spiky") say how far to trust it. It has no low case: look each gauge up on top-gauges (lowUsdPerDay).
- GET https://aeroallocator.app/api/top-gauges?chain=8453&amount=10000&limit=10 : the gauges on a chain ranked by what the amount earns per day in each, with the low case (lowUsdPerDay), pace (thin, fair, solid or spiky: a spiky gauge's usdPerDay is a burst well above its usual level, so lean on lowUsdPerDay), hours of fee history (historyHours), steadiness and a note when incentives end inside the wait (incentivesNote, null when none) (the page's table as data). chain=all ranks every chain against its own fees and merges them (the page's "All networks" view), each row with its chainId; the ETH to reach a chain other than Base is not counted there (all-chains-split weighs it).
- GET https://aeroallocator.app/api/track-record : the site's own track record: each day's recommended split for 10,000 sAERO on Base, logged before the fact, against what those gauges paid two days later. From 2026-11-11 each day also says what the same amount in each Aero Autopilot pool paid (spread like the pool that morning, before its fee). Each day and the results also give the figures as an APR on the amount's value in AERO (paceAprPct, realizedAprPct). Results appear after 14 checked days; before that it reports how many days are logged.
- GET https://aeroallocator.app/api/allocation-fee?chain=10&gauges=2 : ETH cost on Base of sending power to another chain (read from Aero's own message adapter).

Rate limits: each route keeps its own limit in server memory, per instance, usually 10 to 30 calls a minute per IP. In production a Vercel Firewall also limits `/api` per IP. A 429 means wait and retry.

## MCP server

A local stdio server, not a remote HTTP MCP: Node 22+, no key, never signs. Add `{ "mcpServers": { "aeroallocator": { "command": "npx", "args": ["-y", "aeroallocator-mcp"] } } }` to your MCP client, or run `npx -y aeroallocator-mcp`.

Tools: `top_gauges`, `best_split_all_chains`, `power_flows`, `gauge_history`, `allocation_fee`, `track_record`. Each makes one GET on the free API above.

## Paid routes (x402)

A request with no payment gets HTTP 402 with the price and our payout address. Pay with any x402 client, then retry. A request that is rejected (400, 404, 422) is never charged. These need something the free reads can't give: a chain read keyed to one position, or ready-made calldata.

- GET https://aeroallocator.app/api/v1/position?tokenId=<id> or ?address=0x… ($0.05) : a position's power, lock, idle vs allocated power, the re-allocation wait (47 hours at launch, read live from the chain), what it earns per day now versus the best split of gauges for its own size, and a stay / switch / allocate recommendation. A switch is only recommended on at least 6 hours of fee history.
- GET https://aeroallocator.app/api/v1/allocate-plan?tokenId=<id>&maxGauges=<1-6> ($0.10) : the unsigned allocate() transaction (to, data, value) for the best split of Base gauges, already simulated as the owner, with the cooldown and warnings. Sign and send it from the owner's wallet. Base only.
- GET https://aeroallocator.app/api/v1/cross-chain-plan?tokenId=<id>&chains=5042:30,10:20 ($0.25) : ordered unsigned allocate() transactions that spread the position over several chains: the best split over every chain after the ETH each extra chain costs, or the chain percentages you give; plans from the position's state on every chain, says what each step waits for, simulates the step that can be sent now. Never signs or sends.

Prices: position $0.05, allocate-plan $0.10, cross-chain-plan $0.25, in USDC on Base. A deployment without its payout address and Coinbase facilitator keys (X402_PAYTO_ADDRESS, CDP_API_KEY_ID, CDP_API_KEY_SECRET) answers these routes with 501 instead of charging.

## Agent skills

- `saero-allocator-automator`: decides when re-allocating a position is worth it and checks an allocate-plan before handing it to the owner's wallet. https://github.com/Hryhorii77/aero-allocator/tree/main/skills/saero-allocator-automator
- `veaero-to-saero-upgrade`: checks and prepares a veAERO to sAERO upgrade (read-only checker; the upgrade itself is irreversible and signed by the owner). https://github.com/Hryhorii77/aero-allocator/tree/main/skills/veaero-to-saero-upgrade

Install: `npx skills add Hryhorii77/aero-allocator --full-depth --skill <name>`. They never sign or send.

## Network and contracts

sAERO and AERO, on Base (8453):

- sAERO escrow (the position NFTs): [`0xBF7977E1521e9a3032bf7243Ee4712f311f13915`](https://basescan.org/address/0xBF7977E1521e9a3032bf7243Ee4712f311f13915)
- Voter (`allocate()`, the root of every allocation): [`0x49d7d4f17Ec56Ef8fA04E464AF5D1A4942CC31e6`](https://basescan.org/address/0x49d7d4f17Ec56Ef8fA04E464AF5D1A4942CC31e6)
- Leaf voter (the same address on every Aero chain): [`0x382409fad8503FbCdbB27A4211551fa03e884078`](https://basescan.org/address/0x382409fad8503FbCdbB27A4211551fa03e884078)
- AERO token: [`0x940181a94A35A4569E4529A3CDfB74e38FD98631`](https://basescan.org/address/0x940181a94A35A4569E4529A3CDfB74e38FD98631)

Public nodes the app reads through (a person's wallet uses its own):

- Base: https://base-rpc.publicnode.com, https://mainnet.base.org
- Ethereum: https://ethereum-rpc.publicnode.com, https://ethereum.reth.rs/rpc
- OP: https://optimism-rpc.publicnode.com, https://mainnet.optimism.io
- Arbitrum: https://arbitrum-one-rpc.publicnode.com, https://arb1.arbitrum.io/rpc
- Ink: https://rpc-gel.inkonchain.com
- Robinhood Chain: https://rpc.mainnet.chain.robinhood.com
- Arc: https://arc-rpc.publicnode.com, https://arc.gateway.tenderly.co, https://arc.drpc.org

## Site routes

- `/`: The allocator: the best split of gauges for an amount, the gauge table per chain or all networks, your positions (read in your browser) and the allocate, return and across-chains flows signed in your own wallet
- `/track-record`: The site's own track record: each day's recommended split for 10,000 sAERO, logged before the fact, against what it really paid
- `/llms.txt`: The short plain-text version of this document
- `/AGENTS.md`: This document
- `/openapi.json`: OpenAPI 3.1 description of the free reads and the paid x402 routes

## Generation

Built by `web/lib/agents-md.ts` (with the endpoint lists from `web/lib/llms-txt.ts`) from the app's own chain list, contract addresses and prices, and served by `web/app/AGENTS.md/route.ts`. The checked copies are `web/docs/agents/AGENTS.md` and `web/docs/agents/llms.txt`: run `npm run generate-agents-md` in `web/` after a change, and CI fails when they are out of date (`--check`). Do not edit them by hand. `web/AGENTS.md` is a different file (Next.js's rules for coding agents); never put this document there.
