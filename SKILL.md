---
name: aero-allocator
description: Forecast next-epoch demand for Aerodrome pools on Base and recommend veAERO vote / incentive allocations. Built for Aerodrome's Predictive Allocation era — reward where fees are going, not where they've been. Read-only onchain analytics; execution stays in your wallet layer.
metadata:
  emoji: ✈️
  homepage: https://github.com/Hryhorii77/aero-allocator
  category: defi-analytics
  chain: base
---

# Aero Allocator

MCP server that gives any agent a live, quantitative view of Aerodrome (Base) incentive markets:

- **predict_demand** — next-epoch trading-fee forecast per pool, plus `predictiveEdgePct`: predicted demand share minus current vote share. Positive edge = under-incentivized pool.
- **recommend_allocation** — a weights-sum-to-100% allocation. `voter_roi` optimally splits your veAERO (pass `votingPowerVe`) accounting for self-dilution, with expected USD rewards per pool; `protocol_efficiency` allocates proportional to predicted demand.
- **prepare_vote_calldata** — unsigned `Voter.vote()` calldata for your wallet layer to review and submit. This skill never signs or holds keys.
- **scan_pools / pool_history** — raw market data: TVL, per-epoch votes, emissions, fees and bribes in USD.

## Setup

```bash
git clone <repo> && cd aero-allocator && npm install
claude mcp add aero-allocator -- npx tsx $(pwd)/src/index.ts
```

Optional env: `BASE_RPC_URL` (defaults to the public Base RPC; a dedicated RPC makes snapshots faster).

## Example prompts

- "Which Aerodrome pools are most under-incentivized right now?"
- "Recommend a voter_roi allocation across 8 pools and show me the reasoning."
- "Prepare vote calldata for veAERO #12345 with that allocation, then send it with my Base wallet." (execution via Base MCP `send_calls`, with your approval)

## Safety

- Read-only by construction: tools return data and unsigned calldata only.
- All forecasts are EWMA + trend extrapolations of onchain epoch history with explicit confidence scores — not financial advice.
- Voting notes: one vote per veNFT per epoch; voting is blocked in the final hour before the Thursday 00:00 UTC epoch flip.

## Hosted access (pay per call, x402)

Two paid endpoints for sAERO (Aero's continuous allocation, which replaced weekly veAERO voting on 2026-10-22), at
`https://aeroallocator.app`. Pay per call in USDC on Base via the [x402 protocol](https://www.x402.org/): no account, no API key, no
wallet connects to this project, and a call that is rejected (400/404/422) is never charged. They are also discoverable in Coinbase's
x402 Bazaar / agentic.market and described at https://aeroallocator.app/llms.txt. (The old weekly-vote endpoints were removed 2026-10-24.)

**`GET /api/v1/position?tokenId=<id>` or `?address=0x…` ($0.05) — where does this sAERO position stand?**
Power, lock, idle vs allocated power, when it can next be re-allocated (47-hour cooldown), what it earns per day now versus the best
split of Base gauges for its own size (fees plus incentives, after its own dilution), and a `stay` / `switch` / `allocate` /
`unknown` recommendation. A switch is only recommended when it beats staying by 5% and $0.05/day and rests on at least 6 hours of fee
history.

**`GET /api/v1/allocate-plan?tokenId=<id>&maxGauges=<1-6>` ($0.10) — the transaction to do it.**
The unsigned `allocate()` call (`transaction.to/data/value`, chain 8453) for the best split of Base gauges, already simulated as the
owner (`simulation.ok` or the plain reason it would be rejected), with `cooldown`, expected USD/day versus now, and `warnings`. Sign
and send it from `sendFrom`; this project never signs or sends. Base only.

Both are estimates: fee figures are a recent pace (see `feeHistoryHours`, `confidence`), and every allocation restarts a 47-hour wait.

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

## Predictive Allocation

When Dromos Labs publishes the Predictive Allocation contracts (September 2026, with the Aero merger — pushed back from the original July target), direct submission lands in `src/adapters/predictive-allocation.ts` — check `predictive_allocation_status` to see if it's live in your installed version.

## Arc

Circle's Arc mainnet (chain ID `5042`) launched 2026-09-16 with Aero (Aerodrome/Velodrome's merged protocol) named as a launch trading partner, but no Sugar/Voter contract addresses on Arc are public yet — no engine support until they are.
