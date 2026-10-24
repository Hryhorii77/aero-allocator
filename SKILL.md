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

## Hosted access (retired)

The pay-per-call x402 endpoints (`/api/v1/position`, `/api/v1/forecast`, `/api/v1/bribe-target`) were removed on 2026-10-24: they
priced the weekly veAERO vote, which Aero replaced with continuous sAERO allocation on 2026-10-22, and Velodrome merged into Aero.
Use the MCP server below (clone and register it), or see https://aeroallocator.app for the sAERO gauge allocator.

## Predictive Allocation

When Dromos Labs publishes the Predictive Allocation contracts (September 2026, with the Aero merger — pushed back from the original July target), direct submission lands in `src/adapters/predictive-allocation.ts` — check `predictive_allocation_status` to see if it's live in your installed version.

## Arc

Circle's Arc mainnet (chain ID `5042`) launched 2026-09-16 with Aero (Aerodrome/Velodrome's merged protocol) named as a launch trading partner, but no Sugar/Voter contract addresses on Arc are public yet — no engine support until they are.
