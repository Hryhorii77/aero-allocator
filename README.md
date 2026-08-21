# aero-allocator

MCP server that forecasts **next-epoch demand** for Aerodrome (Base) or Velodrome (Optimism) pools and turns it into concrete incentive-allocation recommendations — built for [Aerodrome's Predictive Allocation](https://cryptobriefing.com/aerodrome-predictive-allocation-dex-liquidity/) era (September 2026, pushed back from the original July target), where incentives follow *predicted future demand* instead of last week's votes. Aerodrome is the default; see [Multi-protocol](#multi-protocol-aerodrome--velodrome) to switch.

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
| `recommend_bribe_placement` | For teams/protocols spending a bribe budget (not voters): estimated vote-share pull per pool, and who gets diluted |
| `recommend_lp_deposit` | For LPs deciding where to stake liquidity: forward-looking AERO-emissions APR per pool (not fee revenue — see below) |
| `prepare_vote_calldata` | Unsigned `Voter.vote()` calldata from an allocation — submit via your own wallet layer (e.g. Base MCP `send_calls`) |
| `prepare_submission` | Unsigned calldata for direct Predictive Allocation submission, once wired up — see [Predictive Allocation adapter](#predictive-allocation-adapter) |
| `predictive_allocation_status` | Whether direct Predictive Allocation submission is wired up yet |
| `backtest_summary` | Walk-forward accuracy of the demand forecast vs. realized fees and a naive baseline — see [Forecast accuracy](#forecast-accuracy) |

**This server never holds keys or signs anything.** Execution is the host agent's job, behind explicit user approval.

## Quick start

```bash
npm install
npm run smoke        # live end-to-end test against Base mainnet
npm run build
```

## Multi-protocol (Aerodrome / Velodrome)

Aerodrome (Base) and Velodrome (Optimism) are the same ve(3,3) lineage — Aerodrome is a Velodrome fork sharing the Sugar/Voter contract pattern — so one engine covers both. A single server process serves **one** protocol, selected at startup:

```json
{
  "mcpServers": {
    "aero-allocator": {
      "command": "npx",
      "args": ["tsx", "/path/to/aero-allocator/src/index.ts"],
      "env": { "AERO_PROTOCOL": "aerodrome" }
    },
    "velo-allocator": {
      "command": "npx",
      "args": ["tsx", "/path/to/aero-allocator/src/index.ts"],
      "env": { "AERO_PROTOCOL": "velodrome" }
    }
  }
}
```

`AERO_PROTOCOL` defaults to `aerodrome` (unchanged behavior if unset). Register both entries to run them side by side — each is a separate process with its own RPC client and caches. Tool descriptions, ve-token naming (`veAERO`/`veVELO`), and reward-token naming (`AERO`/`VELO`) all switch automatically with the configured protocol; `predictive_allocation_status` correctly reports the mechanism as not applicable when running Velodrome, since Dromos Labs' announcement is Aerodrome-specific.

RPC selection: `RPC_URL` (new, works for either protocol) always wins if set; otherwise `BASE_RPC_URL` is honored for backward compatibility when running Aerodrome; otherwise each protocol falls back to a public default (`base-rpc.publicnode.com` / `mainnet.optimism.io`).

### Dashboard

A "predicted hot pools" web UI lives in `web/` (Next.js, reuses the engine directly) — currently Aerodrome/Base only:

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

`recommend_bribe_placement` flips this around for teams/protocols spending a bribe budget instead of voters: it re-runs the same water-fill over the market's entire active voting power, with and without the bribe added to one pool's payout, and reports the vote-share delta. Votes water-fill ∝ √payout, so a bribe dollar pulls disproportionately more on a cheap pool than an already-large one. This models an instant, frictionless, whole-market reallocation, so it's a theoretical ceiling, not a forecast — useful for *comparing* candidate pools, not for predicting a literal vote count.

`recommend_lp_deposit` targets a third audience — LPs deciding where to deposit and stake liquidity — and deliberately does **not** rank by `predictedFeesUsd`. On Aerodrome, trading fees (and bribes) accrue to veAERO **voters**, not to liquidity **stakers**; stakers instead earn AERO emissions pro-rata to staked TVL. So this tool forecasts next-epoch emissions from each pool's emissions history with the same EWMA+trend model `predict_demand` uses for fees, and annualizes the result against current staked TVL as `predictedNextEpochAprPct`. It also reports `currentEpochAprPct`, which needs no forecast at all — the live epoch's emission rate was already fixed by votes cast before it started, so it's read directly rather than predicted.

## Forecast accuracy

`confidence` on each forecast starts as a heuristic (history depth + variance), then gets recalibrated
against real backtested accuracy before it reaches any tool output — see [Confidence
calibration](#confidence-calibration) below. `backtest_summary` (tool) and `npm run backtest` (script)
expose the full validation.

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

### Confidence calibration

The heuristic confidence (`depthScore × stabilityScore`) is a guess at how trustworthy a forecast is —
it's never seen a real outcome. `deriveConfidenceCalibration` buckets every walk-forward backtest point
by its *raw* heuristic confidence, computes the actual WAPE realized within each bucket, and converts
that to `calibratedConfidence = 1/(1+wape)` (the same functional form the heuristic already uses for its
own variance term). `predict_demand`, `recommend_allocation` and `recommend_bribe_placement` then remap
every live forecast's confidence through this curve via `applyConfidenceCalibration` — so a
confidence range that the heuristic thought looked solid but has actually been noisy in practice gets
marked down, and vice versa. This matters beyond display: confidence directly weights the `voter_roi`
reward estimate and gates `recommend_bribe_placement`'s candidate pools, so a miscalibrated score would
quietly bias both.

Buckets with fewer than 8 backtest samples are dropped rather than trusted, and any forecast whose raw
confidence falls in a dropped (or as-yet-uncomputed) range keeps its heuristic score — calibration is
opportunistic on top of the always-available heuristic, never a hard dependency. If a fresh
`backtest_summary` hasn't run yet in the last hour, the relevant tools fetch one alongside the market
snapshot (concurrently, so it doesn't add to the wait) and fall back to the raw heuristic if that fetch
fails for any reason.

Run `npm run backtest` for a console report, or call `backtest_summary` from any connected agent for
live numbers (cached ~1h; `AERO_BACKTEST_EPOCHS` / `AERO_BACKTEST_MAX_POOLS` tune the depth/breadth).

## Predictive Allocation adapter

Dromos Labs announced the mechanism but hasn't published contracts/ABI yet (as of 2026-08-16; launch has slipped from July to September 2026). Everything mechanism-specific lives behind one interface in `src/adapters/predictive-allocation.ts`, and it's fully config-driven — no code changes needed on launch day, just set env vars once Dromos publishes the address and ABI:

| Var | Example | |
|---|---|---|
| `AERO_PREDICTIVE_ALLOCATION_ADDRESS` | `0x...` | The mechanism's contract address |
| `AERO_PREDICTIVE_ALLOCATION_ABI` | `["function submitAllocation(uint256 tokenId, address[] pools, uint256[] weights)"]` | Human-readable ABI (JSON array), single function |
| `AERO_PREDICTIVE_ALLOCATION_FUNCTION` | `submitAllocation` | Function name to call |
| `AERO_PREDICTIVE_ALLOCATION_ARGS` | `["veNftId","pools","weightsBps"]` | Positional arg roles — supported: `veNftId`, `pools`, `weightsBps` (100 = 1%, matches `Voter.vote()`), `weightsWad` (fraction of 1e18) |

With all four set, `prepare_submission` builds real calldata; `predictive_allocation_status` reports `live: true`. Until then, `prepare_submission` fails with a clear "not published yet" error and `prepare_vote_calldata` targets the classic `Voter.vote()` flow, which works today.

## Configuration (env)

| Var | Default | |
|---|---|---|
| `AERO_PROTOCOL` | `aerodrome` | `aerodrome` (Base) or `velodrome` (Optimism) — see [Multi-protocol](#multi-protocol-aerodrome--velodrome) |
| `RPC_URL` | protocol default | Dedicated RPC, either protocol — always wins if set |
| `BASE_RPC_URL` | `https://base-rpc.publicnode.com` | Legacy alias for `RPC_URL`, honored when `AERO_PROTOCOL=aerodrome` |
| `AERO_MIN_TVL_USD` | `50000` | Candidate pool TVL floor |
| `AERO_MAX_CANDIDATES` | `60` | Pools receiving full epoch-history analysis |
| `AERO_BACKTEST_EPOCHS` | `26` | Epochs of history pulled per pool for `backtest_summary` |
| `AERO_BACKTEST_MAX_POOLS` | `30` | Pools analyzed per default `backtest_summary` run |

## Contracts used

Both from `velodrome-finance/sugar`'s `deployments/{base,optimism}.env`; reward-token addresses cross-checked against DefiLlama + CoinGecko.

| | Aerodrome (Base, 8453) | Velodrome (Optimism, 10) |
|---|---|---|
| LpSugar | `0x69dD9db6d8f8E7d83887A704f447b1a584b599A1` | `0x347512180804A8B40AA7525AE932a31198F074aA` |
| RewardsSugar | `0x1b121EfDaF4ABb8785a315C51D29BCE0552A7678` | `0x62CCFB2496f49A80B0184AD720379B529E9152fB` |
| VeSugar | `0x4d6A741cEE6A8cC5632B2d948C050303F6246D24` | `0xFE0a44d356a9F52c9F1bE0ba0f0877d986438c9C` |
| Voter | `0x16613524e02ad97eDfeF371bC883F2F5d6C480A5` | `0x41C914ee0c7E1A5edCD0295623e6dC557B5aBf3C` |
| Reward token (AERO/VELO) | `0x940181a94A35A4569E4529A3CDfB74e38FD98631` | `0x9560e827aF36c94D2Ac33a39bCe1fe78631088dB` |

## Roadmap

- [x] Predictive Allocation adapter is config-driven and launch-ready — wiring the real contracts is an env var change (`prepare_submission`)
- [ ] Social/attention signals (Farcaster mentions, token listings) as forecast features
- [x] Backtest harness: replay past epochs, score forecast vs realized fees, publish accuracy (`backtest_summary`, `npm run backtest`)
- [ ] x402-monetized hosted endpoint (pay-per-forecast in USDC via Bankr)
- [x] "Predicted hot pools" dashboard (`web/`)
- [x] Wallet connection + one-click vote from the dashboard (wagmi)
- [x] Multi-protocol: Velodrome (Optimism) alongside Aerodrome (Base), selected via `AERO_PROTOCOL`
- [ ] Dashboard (`web/`) multi-protocol support (currently Aerodrome/Base only)

## Disclaimer

Forecasts are statistical extrapolations of onchain history, not financial advice. Always review calldata before signing.
