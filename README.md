# aero-allocator

[![CI](https://github.com/Hryhorii77/aero-allocator/actions/workflows/ci.yml/badge.svg)](https://github.com/Hryhorii77/aero-allocator/actions/workflows/ci.yml)

**https://aeroallocator.app** is the sAERO allocator for [Aero](https://aero.xyz) (the merged Aerodrome and Velodrome, live since
2026-10-22): which gauges pay the most per day for your amount of sAERO, what your positions earn, and an allocate / return-to-idle
flow signed in your own wallet. It is free, has no accounts, and never holds keys. Figures are estimates from recent on-chain fee
releases, not financial advice.

This repository holds two things:

- **`web/`**: the Next.js site above, plus its free and paid (x402) APIs. This is the live product. Start with [The site](#the-site).
- **`src/` and `scripts/`**: an MCP server and forecasting engine for the *weekly-vote* era (Aerodrome/Velodrome, before Aero). Aero
  replaced weekly voting with continuous allocation, so it no longer powers the site beyond its config and prices; it is kept for
  anyone who still wants it. See [Legacy: weekly-vote engine and MCP server](#legacy-weekly-vote-engine-and-mcp-server).

## The site

What it does (all in `web/`, one page):

- **Gauges**: every Aero gauge on Base (and the other Aero chains) ranked by what *your amount* earns per day after it dilutes the
  gauge, with an estimated APR, a "power flow" column (which gauges are gaining or losing share of the allocation weight), a Steady
  column (how evenly a gauge paid), flags for gauges whose incentives just appeared, and a per-gauge history chart (6-hour bars, plus
  a per-day chart from a 90-day record). The best split across up to six gauges is solved for you.
- **Your positions**: paste an address or connect a wallet. Positions are read **in the browser** over public RPC, so the address never
  reaches our server. Each shows size, lock, how much is allocated, the 47-hour wait (with a "remind me" calendar file, built in the
  browser), what it earns now vs the best split and so what staying costs per day, and the trading fees it has earned and not
  claimed. Allocating simulates the transaction on-chain before your wallet is asked to sign.
- **Notes it keeps honest**: the 47-hour wait belongs to each position, an existing position can't be split, a position with no AERO
  staked is usually an Aero Autopilot key, and fee figures are a recent pace, not a promise.

How the numbers are made: gauge weight is read from Aero's contracts; fees come from the fee releases (`NotifyFeesAmount` logs) over
the last 48 hours, with each gauge's first release left out; incentives are the streaming programs on each gauge. A yield per gauge is
`(fees + incentives) × amount / (weight + amount)`. Against Aero's own pages, total allocation matched and APR was within about a point
or two on the pools compared.

### APIs

Free, rate limited, no key. Described for agents at `/llms.txt` (plain text) and `/openapi.json` (OpenAPI 3.1, including the paid routes' 402 behaviour):

| Endpoint | |
|---|---|
| `GET /api/gauges?chain=8453` | Every gauge on a chain with weight, caps and incentives; the Base list also carries `cooldownSec`, the live wait between allocations of one position (Base 8453, Ethereum 1, OP 10, Arbitrum 42161, Ink 57073, Robinhood 4663, Arc 5042) |
| `GET /api/gauge-fees?chain=8453` | Estimated fees per day per gauge, the hours of history behind each figure, a steadiness figure, and a `spike` marker when the recent pace is at least 3x the gauge's usual level (a burst, not a trend) |
| `GET /api/gauge-history?chain=8453&gauge=0x…` | One gauge's fees per 6 hours, weight snapshots, steadiness, and per-day points from the 90-day record |
| `GET /api/gauge-flows?chain=8453` | How each gauge's share of the allocation weight moved over the last day, and gauges whose incentives just appeared |
| `GET /api/all-chains-split?amount=100000&days=30` | best split of an amount over every chain, after the ETH each extra chain costs (read-only) |
| `GET /api/allocation-fee?chain=10&gauges=2` | ETH cost on Base of sending power to another chain |
| `GET /api/token-prices?tokens=0x…` | USD prices for up to 12 Base token addresses (lets the page value earned fees without sending a position anywhere) |
| `GET /api/share?vp=<amount>` | The 1200×630 share card (also the link preview) |

Paid (x402), below: [Paid API (x402)](#paid-api-x402).

### Running it

```bash
npm install && npm run build      # the engine's dist/, which web/ imports
cd web && npm install && npm run dev
```

Open http://localhost:3000. `web/` imports the engine as compiled `dist/`, so rebuild the root after changing `src/`. Checks: `npm run
typecheck`, `npm test` and `npm run build` in the root and in `web/` (plus `npm run lint` in `web/`), and `npx tsx scripts/audit-gate.ts .` and `... web` (CI runs all of them; the audit gate fails on any advisory except the one accepted zod finding it lists). Node 22 or newer.

History is kept by Vercel Cron: six crons (one per chain, `web/vercel.json`) call `/api/gauge-fees/ingest` every 30 minutes, which
extends the fee record (4 days), takes a weight snapshot (3 days) and, once a UTC day has finished, adds it to the daily record
(90 days). All three live in private Vercel Blobs. If `CRON_SECRET` is set, the route requires it as a bearer token (Vercel Cron sends
it by itself).

### Environment (`web/`)

| Var | | |
|---|---|---|
| `RPC_URL`, `RPC_URL_FALLBACK` | optional | A dedicated RPC, and a second one for failover. Without them public nodes are used, which works but is slower and rate limited |
| `BLOB_READ_WRITE_TOKEN` | needed for history | Vercel Blob token for the fee, weight and daily records. Without it the site works but shows no history |
| `CRON_SECRET` | recommended | Locks `/api/gauge-fees/ingest` to Vercel Cron |
| `NEXT_PUBLIC_SITE_URL` | `https://aeroallocator.app` | Public address, for the link-preview image |
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | unset | Free [Reown Cloud](https://cloud.reown.com) project id (the domain must be on its allowlist). Enables WalletConnect; without it that connector is left out because its relay socket would hang the tab |
| `X402_PAYTO_ADDRESS`, `CDP_API_KEY_ID`, `CDP_API_KEY_SECRET` | for the paid routes | See [Paid API (x402)](#paid-api-x402) |

### Deploying to Vercel

The dashboard depends on the engine package via a local `file:..` reference, which needs some
non-default project settings to build correctly on Vercel — the framework's zero-config detection
doesn't handle this monorepo shape out of the box:

| Setting | Value | Why |
|---|---|---|
| Root Directory | `web` | Vercel's Next.js detection checks *this* directory's `package.json` for a `next` dependency — pointing it at the repo root (which has no `next` dep) fails detection entirely |
| Install Command | `npm install` (default) | Must be a real install, not a no-op — Vercel checks the installed Next.js version immediately after this step, before running Build Command |
| Build Command | `cd .. && npm install --include=dev && npm run build && cd web && npm run build` | Builds the engine's `dist/` first (needs `--include=dev` for `typescript`/`@types/node`, which a plain `npm install` can skip in Vercel's build environment), then the Next.js app that depends on it |
| Output Directory | default (`.next`) | Resolved *relative to Root Directory* — do not prefix with `web/` (that double-counts and fails with "output directory not found") |

Root Directory isn't exposed as a `vercel` CLI flag; set it via the dashboard (Project Settings →
General) or the API (`PATCH /v9/projects/{id}` with `{"rootDirectory": "web"}`). Env vars (see the table above) go in Project
Settings → Environment Variables, per environment (Production/Preview), and take effect on the next deployment. A dedicated RPC (Alchemy,
Infura) is strongly recommended over the public default — it's the difference between a ~20s and a
~1min cold snapshot build, which matters against Vercel's function timeout (60s ceiling on Hobby).

Vercel's Deployment Protection (an SSO auth wall) is on by default for all deployments including
production. To make production public while keeping preview deployments protected, set
`ssoProtection.deploymentType` to `"preview"` via the API (also not a dashboard toggle at the time of
writing).


## Agent skills

Two skills in `skills/`, for agents that act on a sAERO position. Neither signs or sends anything; the owner's wallet layer does.

| Skill | What it does |
|---|---|
| [`skills/saero-allocator-automator`](skills/saero-allocator-automator/SKILL.md) | Once the wait is over, checks a position and re-allocates it only for a real, steady gain (never a one-off fee burst), checks the unsigned `allocate()` before handing it to the owner's wallet. `scripts/decide.mjs` holds the rules; `scripts/run.mjs` runs one pass. |
| [`skills/veaero-to-saero-upgrade`](skills/veaero-to-saero-upgrade/SKILL.md) | Checks a wallet's old veAERO locks against Aero's migration contract (what each becomes, what blocks it) and, only after the owner confirms each lock, prepares the unsigned `approve` and `depositVeNFT`. An expired lock becomes liquid AERO, not a sAERO position; the upgrade is irreversible. |

The root [`SKILL.md`](SKILL.md) is the overview of the APIs for agents. The skills are in this public repo, so no separate publishing is needed; install them with the [`skills`](https://www.npmjs.com/package/skills) CLI (the root skill hides the others unless you pass `--full-depth`):

```bash
npx skills add Hryhorii77/aero-allocator                                                  # the overview skill
npx skills add Hryhorii77/aero-allocator --full-depth --skill saero-allocator-automator   # re-allocate when it is worth it
npx skills add Hryhorii77/aero-allocator --full-depth --skill veaero-to-saero-upgrade     # check and prepare an upgrade
```

Review a skill before you use it: it runs with your agent's permissions.

## Paid API (x402)

Two pay-per-call sAERO endpoints on the site's own deployment, in USDC on Base via the [x402 protocol](https://www.x402.org/), settled by
Coinbase's CDP facilitator only after a successful answer (a 400/404/422 is never charged). The free site and MCP server are unaffected.
The first two are listed in Coinbase's x402 Bazaar (and so agentic.market) since their first settled payments on 2026-10-26 (the cross-chain plan joins once it has had a first settled payment), and described for agents at `/llms.txt` and `/openapi.json`.

| Endpoint | Price | What it answers |
|---|---|---|
| `GET /api/v1/position?tokenId=<id>` or `?address=0x…` | $0.05 | Where does this sAERO position stand: power, lock, idle vs allocated, the 47-hour re-allocation wait, what it earns per day now vs the best split of Base gauges for its own size, and a stay / switch / allocate / unknown recommendation. |
| `GET /api/v1/allocate-plan?tokenId=<id>&maxGauges=<1-6>` | $0.10 | The unsigned, already-simulated `allocate()` transaction for that best split (to, data, value, chain 8453), with cooldown and warnings. Never signs or sends. Base only. |
| `GET /api/v1/cross-chain-plan?tokenId=<id>&chains=5042:30,10:20` | $0.25 | The ordered, unsigned `allocate()` transactions that spread the position over several chains: the best split over every chain after the ETH each extra chain costs (or the percentages given, Base keeping the rest), planned from the position's state on every chain (returns, sends, partial moves). Each step has its ETH, what it waits for (each chain's own wait, return messages from other chains) and, for step 1, a simulation as the owner. Call again between steps. Never signs or sends. The first call can take ~20 s while seven chains are read. |

These answer something the free `/api/gauges` and `/api/gauge-fees` reads can't: a chain read keyed to one position, and calldata that
satisfies the Voter's rules (full overwrite per chain, exact total, ascending addresses). The old weekly-vote `/api/v1/forecast` earned
almost nothing because the free site served the same payload; keep new paid routes on the "free can't do this" side.

Requires three env vars to activate; without all three each paid route serves a clean `501` rather than accepting payment:

| Var | | |
|---|---|---|
| `X402_PAYTO_ADDRESS` | Base address you control | Where payments land: never generated or held by this codebase |
| `CDP_API_KEY_ID` | From [portal.cdp.coinbase.com](https://portal.cdp.coinbase.com/) | Coinbase Developer Platform API key |
| `CDP_API_KEY_SECRET` | Same place | Paired secret |


## Legacy: weekly-vote engine and MCP server

Everything below describes the engine and MCP server built for the weekly-vote era; the site above does not use them beyond `config` and
`prices`.

MCP server that forecasts **next-epoch demand** for Aerodrome (Base) or Velodrome (Optimism) pools and turns it into concrete incentive-allocation recommendations, built for [Aerodrome's Predictive Allocation](https://cryptobriefing.com/aerodrome-predictive-allocation-dex-liquidity/) era, where incentives follow *predicted future demand* instead of last week's votes. Aerodrome is the default; see [Multi-protocol](#multi-protocol-aerodrome--velodrome) to switch.

Any MCP-capable agent (Claude Code, Claude Desktop, Bankr-hosted agents) can use it to answer which pools will generate the most fees next epoch, where vote share is mispriced vs predicted demand, and how to split veAERO votes or an incentive budget. All data comes live from Base (Aerodrome Sugar contracts, DefiLlama prices). No API keys required.

### Tools

| Tool | What it does |
|---|---|
| `scan_pools` | Gauge-enabled pools with live TVL, staked TVL, fee tier |
| `pool_history` | Per-epoch votes, emissions, fees (USD), bribes (USD) for one pool |
| `predict_demand` | Next-epoch fee forecast per pool + **predictiveEdgePct** (predicted demand share − current vote share) |
| `recommend_allocation` | Weighted allocation: `protocol_efficiency` (∝ predicted demand), `voter_roi` (dilution-aware optimal split of your veAERO — the one for "where should I vote"), or `edge_hunter` (biggest trustworthy mispricings) |
| `recommend_bribe_placement` | For teams/protocols spending a bribe budget (not voters): estimated vote-share pull per pool, and who gets diluted |
| `recommend_lp_deposit` | For LPs deciding where to stake liquidity: forward-looking AERO-emissions APR per pool (not fee revenue — see below) |
| `detect_vote_swings` | Pools whose in-progress epoch is running well off its own trend in bribes (risers) or votes (fallers) — the "an incentivized pool is draining regular pools right before lock" pattern |
| `prepare_vote_calldata` | Unsigned `Voter.vote()` calldata from an allocation — submit via your own wallet layer (e.g. Base MCP `send_calls`) |
| `prepare_submission` | Unsigned calldata for direct Predictive Allocation submission, once wired up — see [Predictive Allocation adapter](#predictive-allocation-adapter) |
| `predictive_allocation_status` | Whether direct Predictive Allocation submission is wired up yet |
| `backtest_summary` | Walk-forward accuracy of the demand forecast vs. realized fees and a naive baseline — see [Forecast accuracy](#forecast-accuracy) |
| `realized_performance` | Your logged `voter_roi` recommendations vs. what actually happened, once each epoch completes — a track record, not a backtest — see [Realized performance tracking](#epoch-reminders-script-only) |

**This server never holds keys or signs anything.** Execution is the host agent's job, behind explicit user approval.

### Quick start

```bash
npm install
npm run smoke        # live end-to-end test against Base mainnet
npm run build
```


### Multi-protocol (Aerodrome / Velodrome)

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

**Only Aerodrome is hosted.** The Velodrome deployment was retired on 2026-09-24: measured the same day, Velodrome ran 53 pools to Aerodrome's 276, $51k of last-epoch fees to $1.55M, and $1.88 of voter ROI per 10,000 ve to $85.52. A market ~45× smaller per unit of voting power didn't justify a second public surface to keep current — and it had quietly stopped auto-deploying, so it was serving stale code. Velodrome remains fully supported as a **self-hosted** target: `AERO_PROTOCOL=velodrome` runs the MCP server and the dashboard against Optimism exactly as before.

`AERO_PROTOCOL` defaults to `aerodrome` (unchanged behavior if unset). Register both entries to run them side by side — each is a separate process with its own RPC client and caches. Tool descriptions, ve-token naming (`veAERO`/`veVELO`), and reward-token naming (`AERO`/`VELO`) all switch automatically with the configured protocol; `predictive_allocation_status` correctly reports the mechanism as not applicable when running Velodrome, since Dromos Labs' announcement is Aerodrome-specific.

RPC selection: `RPC_URL` (new, works for either protocol) always wins if set; otherwise `BASE_RPC_URL` is honored for backward compatibility when running Aerodrome; otherwise each protocol falls back to a public default (`base-rpc.publicnode.com` / `mainnet.optimism.io`). Every deployment also gets automatic failover to a second public RPC (`RPC_URL_FALLBACK`, overridable) if the primary goes down outright, not just rate-limited.


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

This is a standard MCP server, not Claude-specific — the same config (in whatever format the client expects) works with Gemini CLI, Cursor, Windsurf, or any other MCP-capable agent, not just the Claude/Bankr ones named above.

Example agent flow:

> "Predict demand for the top Aerodrome pools, recommend a voter_roi allocation across 8 pools, then prepare the vote calldata for my veAERO #12345 and submit it with my Base wallet."


### How the forecast works

For each candidate pool (top N by staked TVL above a TVL floor):

1. Pull up to 8 weekly epochs of history from `RewardsSugar.epochsByAddress` — votes, emissions, fees, incentives per epoch — and price everything in USD.
2. Extrapolate the **in-progress epoch** to full length once >20% has elapsed (the freshest demand signal).
3. Forecast next-epoch fees = EWMA (α=0.45) + ½ × linear trend, floored at 0. Confidence scores from history depth and variance.
4. `predictiveEdge` = predicted fee-demand share − current vote share. Positive edge → under-incentivized pool: exactly what a prediction-market allocator should reward.

Three allocation objectives — each answers a different question, and they can disagree sharply:

- **protocol_efficiency** — weights ∝ predicted demand share. This is the Predictive Allocation ideal; a market-wide benchmark, not personalized — useful for treasuries/protocols directing incentives and for benchmarking the live mechanism once it ships. **Not** a personal voting recommendation: it doesn't know your veAERO amount or account for dilution.
- **voter_roi** — maximize *your* expected next-epoch reward for a given veAERO amount (`votingPowerVe`). Each pool pays pro-rata (`R·v/(E+v)`), so the optimizer water-fills votes to equalize marginal returns — dust pools with high headline ROI but no reward capacity naturally get few or no votes (plus a hard $500 capacity floor). Each pool's expected payout is also split into a bribe floor (posted incentives, already committed) and a fee part (last epoch's fees assumed to repeat, the riskier half; replayed over settled epochs this paid about 62% of what it promised at 10k ve against about 51% for the forecast model, and earned 7-9% more at 10k-100k) rather than one blended number. Output includes the expected USD reward per pool after self-dilution. Pools that clear the $500 floor but whose slice of a small `votingPowerVe` would still earn under a ~$0.40/pool gas hurdle (`gasHurdleUsd`, env `AERO_GAS_HURDLE_USD`) are collapsed away rather than split into — a small holder gets 1-3 pools, not an 8-way split not worth the extra calldata. **This is the one to use for "where should I actually vote"** — but only if you pass your real veAERO amount; the default (10,000) can produce a meaningfully different split than what's optimal for a much larger or smaller holder.
- **edge_hunter** — ranks pools by `predictiveEdge × confidence`: the biggest, most-trustworthy mispricings between predicted demand and current votes, rather than raw demand (protocol_efficiency) or dilution-optimal ROI (voter_roi). Only positive edge counts (under-incentivized — the "buy" signal); a big edge from a low-confidence forecast can rank below a smaller edge the model actually trusts. Not dilution-aware — pair it with `voter_roi` to size a real vote once you've picked targets.

`recommend_bribe_placement` flips this around for teams/protocols spending a bribe budget instead of voters: it re-runs the same water-fill over the market's entire active voting power, with and without the bribe added to one pool's payout, and reports the vote-share delta. Votes water-fill ∝ √payout, so a bribe dollar pulls disproportionately more on a cheap pool than an already-large one. This models an instant, frictionless, whole-market reallocation, so it's a theoretical ceiling, not a forecast — useful for *comparing* candidate pools, not for predicting a literal vote count.

`recommend_lp_deposit` targets a third audience — LPs deciding where to deposit and stake liquidity — and deliberately does **not** rank by `predictedFeesUsd`. On Aerodrome, trading fees (and bribes) accrue to veAERO **voters**, not to liquidity **stakers**; stakers instead earn AERO emissions pro-rata to staked TVL. So this tool forecasts next-epoch emissions from each pool's emissions history with the same EWMA+trend model `predict_demand` uses for fees, and annualizes the result against current staked TVL as `predictedNextEpochAprPct`. It also reports `currentEpochAprPct`, which needs no forecast at all — the live epoch's emission rate was already fixed by votes cast before it started, so it's read directly rather than predicted.

`detect_vote_swings` watches for the pattern voters chase in the final hours of an epoch: a pool suddenly gets a large bribe, and votes drain toward it from everywhere else before lock. For each pool it forecasts a full-epoch baseline from completed-epoch history (same EWMA+trend model, applied to bribes and votes instead of fees), scales it by how much of the epoch has elapsed to get an expected-so-far value, and compares that against the actual in-progress epoch. **risers** are pools whose bribes are running ahead of pace — the early, causal signal, since a bribe can land in one transaction. **fallers** are pools whose votes are running behind pace — the effect, once other voters have reacted. A brand-new bribe with no comparable prior-epoch baseline is reported with a null ratio rather than a meaningless divide-by-near-zero number, and a gauge that had effectively no votes by this point in prior epochs is reported as having no vote-pace baseline at all — the same division would otherwise turn any votes at all into a nine-figure percentage. Like the reminder script, this sharpens as the epoch progresses and is noisiest early on.

### Forecast accuracy

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

#### Confidence calibration

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

### Predictive Allocation adapter

Dromos Labs announced the mechanism but hasn't published contracts/ABI yet (as of 2026-08-16; launch has slipped from July to September 2026). Everything mechanism-specific lives behind one interface in `src/adapters/predictive-allocation.ts`, and it's fully config-driven — no code changes needed on launch day, just set env vars once Dromos publishes the address and ABI:

| Var | Example | |
|---|---|---|
| `AERO_PREDICTIVE_ALLOCATION_ADDRESS` | `0x...` | The mechanism's contract address |
| `AERO_PREDICTIVE_ALLOCATION_ABI` | `["function submitAllocation(uint256 tokenId, address[] pools, uint256[] weights)"]` | Human-readable ABI (JSON array), single function |
| `AERO_PREDICTIVE_ALLOCATION_FUNCTION` | `submitAllocation` | Function name to call |
| `AERO_PREDICTIVE_ALLOCATION_ARGS` | `["veNftId","pools","weightsBps"]` | Positional arg roles — supported: `veNftId`, `pools`, `weightsBps` (100 = 1%, matches `Voter.vote()`), `weightsWad` (fraction of 1e18) |

With all four set, `prepare_submission` builds real calldata; `predictive_allocation_status` reports `live: true`. Until then, `prepare_submission` fails with a clear "not published yet" error and `prepare_vote_calldata` targets the classic `Voter.vote()` flow, which works today.

#### Arc

Circle's Arc mainnet (chain ID `5042`, EVM-compatible, gas paid in USDC) launched 2026-09-16, and "Aero" — Aerodrome and Velodrome's planned merged protocol — is named as a launch trading-infrastructure partner. As of this writing, no Sugar/Voter/veAERO-equivalent contract addresses on Arc have been published anywhere (checked Arc's own contract-address docs and `aerodrome-finance/contracts` on GitHub), and it's not yet clear whether voting stays Base-hub-only or becomes Arc-local — so there's nothing here to build against yet. Tracked as a roadmap item once addresses and an ABI are public.


### Configuration (env, engine and scripts)

| Var | Default | |
|---|---|---|
| `AERO_PROTOCOL` | `aerodrome` | `aerodrome` (Base) or `velodrome` (Optimism) |
| `RPC_URL` | protocol default | Dedicated RPC, either protocol; always wins if set |
| `BASE_RPC_URL` | `https://base-rpc.publicnode.com` | Legacy alias for `RPC_URL`, honored when `AERO_PROTOCOL=aerodrome` |
| `RPC_URL_FALLBACK` | protocol default | Automatic failover if `RPC_URL` goes down (not just rate-limited) |
| `AERO_MIN_TVL_USD` | `50000` | Candidate pool TVL floor |
| `AERO_MAX_CANDIDATES` | `300` | Pools receiving full epoch-history analysis, ranked by staked TVL. A lower value silently excludes small-but-high-APR pools from every ranked tool |
| `AERO_BACKTEST_EPOCHS` | `26` | Epochs of history pulled per pool for `backtest_summary` |
| `AERO_BACKTEST_MAX_POOLS` | `30` | Pools analyzed per default `backtest_summary` run |
| `AERO_DISCORD_WEBHOOK_URL` | unset | `npm run epoch-reminder` also posts its summary to this Discord webhook |
| `AERO_VOTING_POWER` | unset | Your veAERO amount: the epoch-reminder post then includes your personal `voter_roi` split |

### Epoch reminders (script only)

`npm run epoch-reminder` (`scripts/epoch-reminder.ts`) prints time-to-flip, the biggest predictive-edge mispricings, any `detect_vote_swings`
signals and a `protocol_efficiency` reference allocation, and posts it to Discord if `AERO_DISCORD_WEBHOOK_URL` is set. **There is no
scheduled workflow for it any more** (the GitHub Actions schedule and the vote-alert emails were removed on 2026-10-24 when weekly voting
ended); run it yourself if you want it.

With `AERO_VOTING_POWER` set it also logs that `voter_roi` recommendation to `data/voter-roi-log.jsonl` (one entry per epoch), and
`npm run realized-performance` (or the `realized_performance` tool) compares each completed epoch against what actually happened, using the
same `R·v/(E+v)` formula the recommendation used, with the epoch's final fees, bribes and votes. That is a track record of your logged
recommendations going forward, not a backtest of the model (see `backtest_summary`), and it can't know whether you actually followed a
recommendation. Reconciliation has to happen within the 8-epoch history window of the epoch completing.

### Contracts used (legacy engine)

Both from `velodrome-finance/sugar`'s `deployments/{base,optimism}.env`; reward-token addresses cross-checked against DefiLlama + CoinGecko.

| | Aerodrome (Base, 8453) | Velodrome (Optimism, 10) |
|---|---|---|
| LpSugar | `0x69dD9db6d8f8E7d83887A704f447b1a584b599A1` | `0x347512180804A8B40AA7525AE932a31198F074aA` |
| RewardsSugar | `0x1b121EfDaF4ABb8785a315C51D29BCE0552A7678` | `0x62CCFB2496f49A80B0184AD720379B529E9152fB` |
| VeSugar | `0x4d6A741cEE6A8cC5632B2d948C050303F6246D24` | `0xFE0a44d356a9F52c9F1bE0ba0f0877d986438c9C` |
| Voter | `0x16613524e02ad97eDfeF371bC883F2F5d6C480A5` | `0x41C914ee0c7E1A5edCD0295623e6dC557B5aBf3C` |
| Reward token (AERO/VELO) | `0x940181a94A35A4569E4529A3CDfB74e38FD98631` | `0x9560e827aF36c94D2Ac33a39bCe1fe78631088dB` |


## Roadmap

- [x] sAERO allocator: ranked gauges, best split, positions read in the browser, allocate and return-to-idle from your wallet
- [x] Fee pace measured from on-chain releases, with weight snapshots, power flow, steadiness, new-incentive flags and a 90-day daily record
- [x] Paid x402 endpoints for agents (`v1/position`, `v1/allocate-plan`, `v1/cross-chain-plan`), `/llms.txt` and `/openapi.json`, listed in the x402 Bazaar
- [x] Two agent skills: re-allocate a position only when it is worth it, and check or prepare a veAERO to sAERO upgrade (read-only, irreversible, verified against Aero's contracts)
- [x] A gauge whose fee pace is a burst is marked spiky and its APR shown as a range
- [x] Per-position wait explanation, calendar reminder, earned-fees read, Autopilot-key handling, and what staying costs per day
- [x] Backtest harness (`backtest_summary`) and realized-performance tracking for the weekly-vote engine
- [ ] Allocating to gauges on other chains (the fee quote is built; the transaction is not)
- [ ] Claiming rewards: not built, because Aero's claim is callable only by a position's operator or Aero's orchestrator
- [ ] A move-or-stay backtest: prototyped and dropped, the record was too short and fees too lumpy; retry with more of the daily record
- [ ] Arc chain support: blocked on Aero/Dromos Labs publishing contract addresses on Arc; see [Arc](#arc)

## Disclaimer

Forecasts are statistical extrapolations of onchain history, not financial advice. Always review calldata before signing.
