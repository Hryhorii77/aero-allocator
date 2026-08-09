# aero-allocator

MCP server that forecasts **next-epoch demand** for Aerodrome pools on Base and turns it into concrete incentive-allocation recommendations — built for [Aerodrome's Predictive Allocation](https://cryptobriefing.com/aerodrome-predictive-allocation-dex-liquidity/) era (September 2026, pushed back from the original July target), where incentives follow *predicted future demand* instead of last week's votes.

Any MCP-capable agent (Claude Code, Claude Desktop, Bankr-hosted agents) can use it to answer:

- Which pools will generate the most fees **next epoch**?
- Where is vote share **mispriced** vs predicted demand (the "predictive edge")?
- How should I split my veAERO votes / incentive budget right now?

All data comes live from Base — Aerodrome Sugar contracts for pool state and per-epoch history, DefiLlama for USD pricing. No API keys required.

## Tools

| Tool | What it does |
|---|---|
| `scan_pools` | Gauge-enabled pools with live TVL, staked TVL, fee tier |
| `pool_history` | Per-epoch votes, emissions, fees (USD), bribes (USD) for one pool |
| `predict_demand` | Next-epoch fee forecast per pool + **predictiveEdgePct** (predicted demand share − current vote share) |
| `recommend_allocation` | Weighted allocation: `protocol_efficiency` (∝ predicted demand) or `voter_roi` (dilution-aware optimal split of your veAERO) |
| `prepare_vote_calldata` | Unsigned `Voter.vote()` calldata from an allocation — submit via your own wallet layer (e.g. Base MCP `send_calls`) |
| `predictive_allocation_status` | Whether direct Predictive Allocation submission is wired up yet |
| `backtest_summary` | Walk-forward accuracy of the demand forecast vs. realized fees and a naive baseline — see [Forecast accuracy](#forecast-accuracy) |

**This server never holds keys or signs anything.** Execution is the host agent's job, behind explicit user approval.

## Quick start

```bash
npm install
npm run smoke        # live end-to-end test against Base mainnet
npm run build
```

### Dashboard

A "predicted hot pools" web UI lives in `web/` (Next.js, reuses the engine directly):

```bash
npm run build                 # engine dist/ used by the web app
cd web && npm install && npm run dev
```

Open http://localhost:3000 — hot-pools table (predicted fees, edge, confidence), plus interactive
Voter ROI (enter your veAERO) and Protocol Efficiency allocation panels. First load builds the
onchain snapshot (~1 min), then it's cached.

Connect a wallet (injected or Coinbase Wallet, Base chain) to cast the Voter ROI allocation as a
real vote: your veAERO NFTs are auto-detected via VeSugar (manual id entry as fallback) and the
"cast vote" button submits `Voter.vote()` with the recommended weights — you sign in your wallet;
the app never holds keys.

Register with Claude Code:

```bash
claude mcp add aero-allocator -- npx tsx /path/to/aero-allocator/src/index.ts
```

Or in any MCP client config:

```json
{
  "mcpServers": {
    "aero-allocator": {
      "command": "npx",
      "args": ["tsx", "/path/to/aero-allocator/src/index.ts"],
      "env": { "BASE_RPC_URL": "https://mainnet.base.org" }
    }
  }
}
```

Example agent flow:

> "Predict demand for the top Aerodrome pools, recommend a voter_roi allocation across 8 pools, then prepare the vote calldata for my veAERO #12345 and submit it with my Base wallet."

## How the forecast works

For each candidate pool (top N by staked TVL above a TVL floor):

1. Pull up to 8 weekly epochs of history from `RewardsSugar.epochsByAddress` — votes, emissions, fees, incentives per epoch — and price everything in USD.
2. Extrapolate the **in-progress epoch** to full length once >20% has elapsed (the freshest demand signal).
3. Forecast next-epoch fees = EWMA (α=0.45) + ½ × linear trend, floored at 0. Confidence scores from history depth and variance.
4. `predictiveEdge` = predicted fee-demand share − current vote share. Positive edge → under-incentivized pool: exactly what a prediction-market allocator should reward.

Two allocation objectives:

- **protocol_efficiency** — weights ∝ predicted demand share. This is the Predictive Allocation ideal; useful for treasuries/protocols directing incentives and for benchmarking the live mechanism once it ships.
- **voter_roi** — maximize your expected next-epoch reward for a given veAERO amount (`votingPowerVe`). Each pool pays pro-rata (`R·v/(E+v)`), so the optimizer water-fills votes to equalize marginal returns — dust pools with high headline ROI but no reward capacity naturally get few or no votes (plus a hard $500 capacity floor). Output includes the expected USD reward per pool after self-dilution.

## Forecast accuracy

`confidence` on each forecast is a heuristic (history depth + variance), not a proven accuracy number —
`backtest_summary` (tool) and `npm run backtest` (script) validate it against real outcomes.

Methodology: walk forward through each pool's completed-epoch history. At every historical epoch
boundary, forecast that epoch using only the epochs that would have actually been available beforehand
(capped at the same trailing window `predict_demand` uses — the backtest never gives the model more
history than it gets live), then compare against what actually happened. Errors are reported as MAE,
RMSE and WAPE (`Σ|error| / Σactual`, robust to the near-zero-fee epochs MAPE chokes on), alongside
**skill vs. baseline** — the same comparison against a naive "predict next epoch = last epoch" model,
so a negative skill number means the EWMA+trend forecast isn't earning its complexity over doing
nothing. A confidence-calibration table checks whether higher-confidence forecasts actually have lower
error. One known gap: this replays epoch-boundary predictions only — it doesn't replay the mid-epoch
pace-extrapolation blend used for the live in-progress epoch.

Run `npm run backtest` for a console report, or call `backtest_summary` from any connected agent for
live numbers (cached ~1h; `AERO_BACKTEST_EPOCHS` / `AERO_BACKTEST_MAX_POOLS` tune the depth/breadth).

## Predictive Allocation adapter

Dromos Labs announced the mechanism but hasn't published contracts/ABI yet (as of 2026-07-24; launch has slipped from July to September 2026). Everything mechanism-specific lives behind one interface in `src/adapters/predictive-allocation.ts` — on launch day, wire the addresses/ABI there and `prepare_submission` goes live. Until then `prepare_vote_calldata` targets the classic `Voter.vote()` flow, which works today.

## Configuration (env)

| Var | Default | |
|---|---|---|
| `BASE_RPC_URL` | `https://mainnet.base.org` | Use a dedicated RPC for faster snapshots |
| `AERO_MIN_TVL_USD` | `50000` | Candidate pool TVL floor |
| `AERO_MAX_CANDIDATES` | `60` | Pools receiving full epoch-history analysis |
| `AERO_BACKTEST_EPOCHS` | `26` | Epochs of history pulled per pool for `backtest_summary` |
| `AERO_BACKTEST_MAX_POOLS` | `30` | Pools analyzed per default `backtest_summary` run |

## Contracts used (Base, 8453)

| | |
|---|---|
| LpSugar v3 | `0x69dD9db6d8f8E7d83887A704f447b1a584b599A1` |
| RewardsSugar | `0x1b121EfDaF4ABb8785a315C51D29BCE0552A7678` |
| Voter | `0x16613524e02ad97eDfeF371bC883F2F5d6C480A5` |

## Roadmap

- [ ] Predictive Allocation live adapter (day-one, when contracts publish)
- [ ] Social/attention signals (Farcaster mentions, token listings) as forecast features
- [x] Backtest harness: replay past epochs, score forecast vs realized fees, publish accuracy (`backtest_summary`, `npm run backtest`)
- [ ] x402-monetized hosted endpoint (pay-per-forecast in USDC via Bankr)
- [x] "Predicted hot pools" dashboard (`web/`)
- [x] Wallet connection + one-click vote from the dashboard (wagmi)

## Disclaimer

Forecasts are statistical extrapolations of onchain history, not financial advice. Always review calldata before signing.
