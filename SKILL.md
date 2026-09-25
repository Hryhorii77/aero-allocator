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

## Instant access (hosted, no setup — x402)

Skip the clone/install/MCP-registration path entirely: pay-per-call over HTTP via the [x402
protocol](https://www.x402.org/), $0.05–$0.10 (per endpoint) in USDC on Base mainnet, verified and settled automatically —
no RPC key, no self-hosting, no wallet ever connects to this project.

**`GET /api/v1/position?address=0x…` — is this wallet's vote any good?**

The one an agent can act on without a human. Pass a wallet address; it reads every veNFT that address
holds, blends them into one portfolio-wide split, sizes the recommendation for that combined voting
power (dilution is size-dependent, so this is not the default-10,000 split), and returns the dollar
difference between staying put and switching:

```jsonc
{
  "votingPower": 341200,
  "hasVoted": true,
  "estimateIfStayUsd": 118.40,   // held pools' last-epoch $/1k rate × your votes there
  "estimateIfSwitchUsd": 173.95, // this forecast's next-epoch model, after dilution
  "deltaUsd": 55.55,
  "comparable": true,            // false ⇒ deltaUsd overstates the gain — see below
  "rows": [ /* per-pool current% vs recommended% */ ]
}
```

**Check `comparable` before acting on `deltaUsd`.** When a pool the wallet currently holds has no
`$/1k` rate available, the "stay" side is an undercount by exactly the amount that couldn't be measured,
which flatters switching. The endpoint reports this rather than hiding it inside a confident-looking
number; `unpricedPools` names the offenders. A negative `deltaUsd` is a real answer too — a wallet
parked in one fat bribed pool can out-earn a diversified split.

**`GET /api/v1/forecast` — the whole market.**

Same data `predict_demand` + `recommend_allocation` return combined: predicted hot pools, all three
allocation objectives (`protocol_efficiency`, `voter_roi`, `edge_hunter`), LP staking yield, and
vote-swing signals. Optional `?votingPower=<amount>` sizes the `voter_roi` split for your holdings.

**`GET /api/v1/bribe-target?pool=0x…&targetSharePct=N` — for protocols paying bribes ($0.10).**

The least bribe that could move a pool to N% of all votes: the bribe simulator run backwards. It returns
`minBribeUsd`, `votesNeeded`, `usdPer1kIncrementalVotes`, `postedBribesUsd` (already on the pool), and a
`costCurve` showing the price of each step toward the target.

**Treat `minBribeUsd` as a floor, not a quote.** The underlying simulator is a theoretical ceiling on how
many votes a bribe pulls (instant, frictionless whole-market re-optimization), so the real bribe needed is at
least this — budget above it. Use it to compare pools and rule out hopeless targets. A target beyond what the
model can reach (no pool takes more than 35% of votes) comes back `feasible: false` with a `reason`, not a
price; an unknown or ineligible pool is a `404` and is not charged.

All three live at `https://aeroallocator.app` (Aerodrome on Base). There is no hosted Velodrome endpoint
any more — run `AERO_PROTOCOL=velodrome` yourself for Optimism.

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

const res = await fetchWithPayment(
  "https://aeroallocator.app/api/v1/position?address=0xYourWallet",
);
const data = await res.json();
```

## Predictive Allocation

When Dromos Labs publishes the Predictive Allocation contracts (September 2026, with the Aero merger — pushed back from the original July target), direct submission lands in `src/adapters/predictive-allocation.ts` — check `predictive_allocation_status` to see if it's live in your installed version.

## Arc

Circle's Arc mainnet (chain ID `5042`) launched 2026-09-16 with Aero (Aerodrome/Velodrome's merged protocol) named as a launch trading partner, but no Sugar/Voter contract addresses on Arc are public yet — no engine support until they are.
