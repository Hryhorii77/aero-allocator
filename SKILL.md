---
name: aero-allocator
description: Forecast next-epoch demand for Aerodrome pools on Base and recommend veAERO vote / incentive allocations. Built for Aerodrome's Predictive Allocation era — reward where fees are going, not where they've been. Read-only onchain analytics; execution stays in your wallet layer.
emoji: ✈️
homepage: https://github.com/Hryhorii77/aero-allocator
metadata:
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

## Instant access (hosted, no setup — x402)

Skip the clone/install/MCP-registration path entirely: pay-per-call over HTTP via the [x402
protocol](https://www.x402.org/), $0.05 in USDC on Base mainnet, verified and settled automatically —
no RPC key, no self-hosting, no wallet ever connects to this project.

- `GET https://aero-allocator.vercel.app/api/v1/forecast` (Aerodrome/Base)
- `GET https://aero-allocator-velodrome.vercel.app/api/v1/forecast` (Velodrome/Optimism)

Same data `predict_demand` + `recommend_allocation` return combined: predicted hot pools, all three
allocation objectives (`protocol_efficiency`, `voter_roi`, `edge_hunter`), LP staking yield, and
vote-swing signals. Optional `?votingPower=<amount>` sizes the `voter_roi` split for your holdings.

Standard x402 flow: a request with no `X-PAYMENT` header gets `402` with the price; a request with a
valid one (signed by any x402-capable wallet or client) is verified before the request runs and settled
on-chain only after a successful response — a failed request is never charged. Any x402-aware agent
framework can call it directly, e.g. with [`@x402/fetch`](https://www.npmjs.com/package/@x402/fetch):

```ts
import { wrapFetchWithPaymentFromConfig } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm";
import { privateKeyToAccount } from "viem/accounts";

const account = privateKeyToAccount("0xYourPrivateKey");
const fetchWithPayment = wrapFetchWithPaymentFromConfig(fetch, {
  schemes: [{ network: "eip155:8453", client: new ExactEvmScheme(account) }],
});

const res = await fetchWithPayment("https://aero-allocator.vercel.app/api/v1/forecast");
const data = await res.json();
```

## Predictive Allocation

When Dromos Labs publishes the Predictive Allocation contracts (September 2026, with the Aero merger — pushed back from the original July target), direct submission lands in `src/adapters/predictive-allocation.ts` — check `predictive_allocation_status` to see if it's live in your installed version.
