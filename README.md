# aero-allocator

[![CI](https://github.com/Hryhorii77/aero-allocator/actions/workflows/ci.yml/badge.svg)](https://github.com/Hryhorii77/aero-allocator/actions/workflows/ci.yml)

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
| `recommend_allocation` | Weighted allocation: `protocol_efficiency` (∝ predicted demand), `voter_roi` (dilution-aware optimal split of your veAERO — the one for "where should I vote"), or `edge_hunter` (biggest trustworthy mispricings) |
| `recommend_bribe_placement` | For teams/protocols spending a bribe budget (not voters): estimated vote-share pull per pool, and who gets diluted |
| `recommend_lp_deposit` | For LPs deciding where to stake liquidity: forward-looking AERO-emissions APR per pool (not fee revenue — see below) |
| `detect_vote_swings` | Pools whose in-progress epoch is running well off its own trend in bribes (risers) or votes (fallers) — the "an incentivized pool is draining regular pools right before lock" pattern |
| `prepare_vote_calldata` | Unsigned `Voter.vote()` calldata from an allocation — submit via your own wallet layer (e.g. Base MCP `send_calls`) |
| `prepare_submission` | Unsigned calldata for direct Predictive Allocation submission, once wired up — see [Predictive Allocation adapter](#predictive-allocation-adapter) |
| `predictive_allocation_status` | Whether direct Predictive Allocation submission is wired up yet |
| `backtest_summary` | Walk-forward accuracy of the demand forecast vs. realized fees and a naive baseline — see [Forecast accuracy](#forecast-accuracy) |
| `realized_performance` | Your logged `voter_roi` recommendations vs. what actually happened, once each epoch completes — a track record, not a backtest — see [Realized performance tracking](#realized-performance-tracking) |

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

**Only Aerodrome is hosted.** The Velodrome deployment was retired on 2026-09-24: measured the same day, Velodrome ran 53 pools to Aerodrome's 276, $51k of last-epoch fees to $1.55M, and $1.88 of voter ROI per 10,000 ve to $85.52. A market ~45× smaller per unit of voting power didn't justify a second public surface to keep current — and it had quietly stopped auto-deploying, so it was serving stale code. Velodrome remains fully supported as a **self-hosted** target: `AERO_PROTOCOL=velodrome` runs the MCP server and the dashboard against Optimism exactly as before.

`AERO_PROTOCOL` defaults to `aerodrome` (unchanged behavior if unset). Register both entries to run them side by side — each is a separate process with its own RPC client and caches. Tool descriptions, ve-token naming (`veAERO`/`veVELO`), and reward-token naming (`AERO`/`VELO`) all switch automatically with the configured protocol; `predictive_allocation_status` correctly reports the mechanism as not applicable when running Velodrome, since Dromos Labs' announcement is Aerodrome-specific.

RPC selection: `RPC_URL` (new, works for either protocol) always wins if set; otherwise `BASE_RPC_URL` is honored for backward compatibility when running Aerodrome; otherwise each protocol falls back to a public default (`base-rpc.publicnode.com` / `mainnet.optimism.io`). Every deployment also gets automatic failover to a second public RPC (`RPC_URL_FALLBACK`, overridable) if the primary goes down outright, not just rate-limited.

### Dashboard

**Live**: https://aeroallocator.app (Aerodrome/Base)

There is no hosted Velodrome dashboard any more — see [Multi-protocol](#multi-protocol-aerodrome--velodrome) for running one yourself.

A "predicted hot pools" web UI lives in `web/` (Next.js, reuses the engine directly):

```bash
npm run build                 # engine dist/ used by the web app
cd web && npm install && npm run dev
```

Open http://localhost:3000. The page is built around one question — where to vote this epoch — and
answers it above the fold without a wallet: the **Voter ROI** card is the first screen. Type how much
veAERO you hold (or paste an address and hit **look up**), and it shows your expected $ next epoch as the
headline, then the pool split that earns it, sized for that amount.

- **Copy weights** puts whole percentages that sum to exactly 100 on the clipboard (largest-remainder
  rounding, pools that would round to 0% dropped): a header line, one `POOL  35%` line per pool, and a
  compact `pcts: 35/35/30` line — for typing into the protocol's own vote screen. **Open Aerodrome**
  links there.
- **Copy share text** puts one tweet-sized line on the clipboard (`10,000 veAERO → ~$85.52 expected next
  epoch · 3 pools · votes close in 5d 13h · aeroallocator.app`), and **share card** opens
  `/api/share?vp=<amount>`, a 1200×630 PNG of the same figure. The site's own link preview uses that card
  at the default amount (`NEXT_PUBLIC_SITE_URL` sets the address for other deployments; without it a
  non-Aerodrome deployment gets no preview image).
- **Address lookup** reads `VeSugar.byAccount` straight from the browser over the public RPC — the address
  never reaches our server — sums that address's veNFTs, fills the amount, and shows how its current
  votes compare with the recommendation. No wallet connection needed; a failed or empty lookup keeps the
  amount you typed. (The same comparison, callable by agents, is the paid `/api/v1/position`.)
- **Connect wallet** is only needed to *cast*, and sits next to the cast controls. The header keeps a
  second connect button.
- Each row shows pool, vote %, veAERO, expected $ and your share of that gauge; TVL, current votes and
  the bribe-floor vs fee-forecast split are behind the row's expand (▸).

Below the card: the hot-pools table (predicted fees, edge, confidence, search + category filters, an
expandable per-pool fee-history sparkline), sorted by edge by default (predicted demand share minus
current vote share — the column that says where to look first, not just which pools are biggest). Then
collapsed panels: **Other objectives** (the Protocol Efficiency and Edge Hunter allocations — market-wide
benchmarks for treasuries and agents, not a personal vote); the LP staking-yield table (thin pools — low
TVL or an APR too high off too little TVL to mean anything — hidden by default, flagged if shown, with a
plain empty state when that leaves nothing); vote swings (risers/fallers, one scannable line per signal);
a bribe-placement simulator; the forecast-accuracy panel (the same walk-forward backtest as
`backtest_summary` — see [Forecast accuracy](#forecast-accuracy)); and a changelog. First load builds the
onchain snapshot (~1 min), then it's cached.

The sticky header carries the vote clock, snapshot age and connect. The mechanism ("weekly gauge voting"),
epoch progress and refresh sit under the headline as quiet text. **On phones the page splits into Vote /
Pools / More tabs**: Vote is the card and its actions, Pools is the hot-pools table, and More holds
everything collapsed above; desktop keeps the single page.

**Vote mode** (on by default) trims the hot-pools table to what a voter actually needs — pool,
predicted fees, trend, edge, $/1k votes, confidence — folding "last epoch" and "votes vs demand" into
each row's expand (▸) instead of dropping them. Toggle it off for the full 8-column table. The row
expand (fee-history sparkline) works the same way on the mobile card layout, not just the desktop
table. When a small `votingPowerVe` collapses Voter ROI to one or two pools (see gas hurdle above),
the panel says so directly rather than leaving a short list to read as a failure.

The header carries two urgency signals with deliberately separate jobs: a vote-clock chip for the
deadline (it counts to the vote *lock* — `Voter.vote()` reverts in the final hour before the Thursday
00:00 UTC flip, so the cast deadline is Wednesday 23:00 UTC; neutral above 12h, amber inside 12h, red and
pushing to "vote now" inside the final 2h, then "voting closed — flips in …" for the last hour) and a snapshot-age chip for the data, which turns red with its own
"may be stale, refresh" once the snapshot is both older than the server's 5-minute cache and close to
the flip. Only one of them ever tells you to refresh. In that last-6h window the page also quietly
auto-refreshes (one forced live rebuild on entering it, then a 60s poll) instead of waiting on the next
visitor to trigger a background refresh.

The veAERO amount you type is remembered locally between visits, so a returning voter isn't handed the
10,000 default again — a shared `?vp=` link still takes precedence, so links keep meaning what they say.

Connect a wallet (injected or Coinbase Wallet) to cast the Voter ROI allocation as a real vote: your
veNFTs are auto-detected via VeSugar (manual id entry as fallback) and all of them are selected by
default — a wallet holding several locks gets its combined voting power and current split immediately,
and the "cast vote" button batches one `Voter.vote()` per selected veNFT into a single Multicall3
transaction (one signature, not N). Uncheck a lock to exclude it. You can also skip connecting and copy
the unsigned `Voter.vote()` calldata for a veNFT id. The dashboard shows your actual current vote split
next to the recommended one (with the $ difference), and you sign in your wallet; the app never holds
keys.

**Multi-protocol**: like the MCP server, one web deployment serves one protocol, fixed at build time
by `AERO_PROTOCOL` (server) and `NEXT_PUBLIC_AERO_PROTOCOL` (client — must be set to the same value;
a console warning fires if they ever drift). Contract addresses used in the vote transaction always
come from the server's `PRESET` via `/api/protocol`, never duplicated client-side, so a mismatched
`NEXT_PUBLIC_AERO_PROTOCOL` can produce wrong labels but never a wrong-contract vote. The hosted Velodrome deployment
was retired on 2026-09-24 (see above), and with it the cross-deployment switcher; a self-hosted Velodrome
dashboard is simply `web/` built with those two variables set to `velodrome`.

#### Deploying to Vercel

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
General) or the API (`PATCH /v9/projects/{id}` with `{"rootDirectory": "web"}`). Env vars (`RPC_URL`,
`AERO_PROTOCOL`, `NEXT_PUBLIC_AERO_PROTOCOL`, optionally `NEXT_PUBLIC_SIBLING_URL`) go in Project
Settings → Environment Variables, per environment (Production/Preview). A dedicated RPC (Alchemy,
Infura) is strongly recommended over the public default — it's the difference between a ~20s and a
~1min cold snapshot build, which matters against Vercel's function timeout (60s ceiling on Hobby).

Vercel's Deployment Protection (an SSO auth wall) is on by default for all deployments including
production. To make production public while keeping preview deployments protected, set
`ssoProtection.deploymentType` to `"preview"` via the API (also not a dashboard toggle at the time of
writing).

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

## Paid API (x402)

Two pay-per-call endpoints on the dashboard deployment, both **$0.05/call in USDC on Base mainnet** via
the [x402 protocol](https://www.x402.org/). The free dashboard and MCP server are unaffected — these are
additional ways to get at the data, not a paywall on the existing ones.

| Endpoint | What it answers |
|---|---|
| `GET /api/v1/position?address=0x…` | **What is *this wallet's* current vote worth versus the recommendation?** Reads every veNFT the address holds, blends them into one portfolio-wide split, sizes the recommendation for that combined voting power, and returns the dollar difference between staying and switching. |
| `GET /api/v1/forecast` | The whole market: predicted hot pools, all three allocation objectives, LP staking yield, vote-swing signals. |

`/api/v1/position` is the one that isn't obtainable free, and that distinction is deliberate. The free
`/api/dashboard` is address-agnostic — it publishes the map. `position` reads a specific caller's on-chain
stance off that map and tells them where they're standing, which needs a chain read keyed to their
address. It's also the shape an agent can act on without a human in the loop: one number, signed sense,
plus `comparable` so a caller knows when the two sides aren't priced on the same basis.

`/api/v1/forecast` serves the same payload as the free `/api/dashboard` (same engine, same numbers), for
callers who want it metered and versioned rather than scraped off the site's own endpoint.

Standard x402 flow: a request without an `X-PAYMENT` header gets `402` with the price; a request with a
valid one is verified by Coinbase's CDP facilitator before the handler runs, and settled on-chain only
after a successful response — a failed request is never charged. [`SKILL.md`](SKILL.md#instant-access-hosted-no-setup--x402)
has a copy-pasteable client example (`@x402/fetch`) for calling this directly from an agent — no clone,
no RPC key, no MCP registration.

Requires three env vars to activate; without all three both routes serve a clean `501` rather than
accepting misrouted or unverifiable payments:

| Var | | |
|---|---|---|
| `X402_PAYTO_ADDRESS` | Base address you control | Where payments land — never generated or held by this codebase |
| `CDP_API_KEY_ID` | From [portal.cdp.coinbase.com](https://portal.cdp.coinbase.com/) | Coinbase Developer Platform API key |
| `CDP_API_KEY_SECRET` | Same place | Paired secret |

## How the forecast works

For each candidate pool (top N by staked TVL above a TVL floor):

1. Pull up to 8 weekly epochs of history from `RewardsSugar.epochsByAddress` — votes, emissions, fees, incentives per epoch — and price everything in USD.
2. Extrapolate the **in-progress epoch** to full length once >20% has elapsed (the freshest demand signal).
3. Forecast next-epoch fees = EWMA (α=0.45) + ½ × linear trend, floored at 0. Confidence scores from history depth and variance.
4. `predictiveEdge` = predicted fee-demand share − current vote share. Positive edge → under-incentivized pool: exactly what a prediction-market allocator should reward.

Three allocation objectives — each answers a different question, and they can disagree sharply:

- **protocol_efficiency** — weights ∝ predicted demand share. This is the Predictive Allocation ideal; a market-wide benchmark, not personalized — useful for treasuries/protocols directing incentives and for benchmarking the live mechanism once it ships. **Not** a personal voting recommendation: it doesn't know your veAERO amount or account for dilution.
- **voter_roi** — maximize *your* expected next-epoch reward for a given veAERO amount (`votingPowerVe`). Each pool pays pro-rata (`R·v/(E+v)`), so the optimizer water-fills votes to equalize marginal returns — dust pools with high headline ROI but no reward capacity naturally get few or no votes (plus a hard $500 capacity floor). Each pool's expected payout is also split into a bribe floor (posted incentives, already committed) and a fee forecast (the confidence-blended, riskier half) rather than one blended number. Output includes the expected USD reward per pool after self-dilution. Pools that clear the $500 floor but whose slice of a small `votingPowerVe` would still earn under a ~$0.40/pool gas hurdle (`gasHurdleUsd`, env `AERO_GAS_HURDLE_USD`) are collapsed away rather than split into — a small holder gets 1-3 pools, not an 8-way split not worth the extra calldata. **This is the one to use for "where should I actually vote"** — but only if you pass your real veAERO amount; the default (10,000) can produce a meaningfully different split than what's optimal for a much larger or smaller holder.
- **edge_hunter** — ranks pools by `predictiveEdge × confidence`: the biggest, most-trustworthy mispricings between predicted demand and current votes, rather than raw demand (protocol_efficiency) or dilution-optimal ROI (voter_roi). Only positive edge counts (under-incentivized — the "buy" signal); a big edge from a low-confidence forecast can rank below a smaller edge the model actually trusts. Not dilution-aware — pair it with `voter_roi` to size a real vote once you've picked targets.

`recommend_bribe_placement` flips this around for teams/protocols spending a bribe budget instead of voters: it re-runs the same water-fill over the market's entire active voting power, with and without the bribe added to one pool's payout, and reports the vote-share delta. Votes water-fill ∝ √payout, so a bribe dollar pulls disproportionately more on a cheap pool than an already-large one. This models an instant, frictionless, whole-market reallocation, so it's a theoretical ceiling, not a forecast — useful for *comparing* candidate pools, not for predicting a literal vote count.

`recommend_lp_deposit` targets a third audience — LPs deciding where to deposit and stake liquidity — and deliberately does **not** rank by `predictedFeesUsd`. On Aerodrome, trading fees (and bribes) accrue to veAERO **voters**, not to liquidity **stakers**; stakers instead earn AERO emissions pro-rata to staked TVL. So this tool forecasts next-epoch emissions from each pool's emissions history with the same EWMA+trend model `predict_demand` uses for fees, and annualizes the result against current staked TVL as `predictedNextEpochAprPct`. It also reports `currentEpochAprPct`, which needs no forecast at all — the live epoch's emission rate was already fixed by votes cast before it started, so it's read directly rather than predicted.

`detect_vote_swings` watches for the pattern voters chase in the final hours of an epoch: a pool suddenly gets a large bribe, and votes drain toward it from everywhere else before lock. For each pool it forecasts a full-epoch baseline from completed-epoch history (same EWMA+trend model, applied to bribes and votes instead of fees), scales it by how much of the epoch has elapsed to get an expected-so-far value, and compares that against the actual in-progress epoch. **risers** are pools whose bribes are running ahead of pace — the early, causal signal, since a bribe can land in one transaction. **fallers** are pools whose votes are running behind pace — the effect, once other voters have reacted. A brand-new bribe with no comparable prior-epoch baseline is reported with a null ratio rather than a meaningless divide-by-near-zero number, and a gauge that had effectively no votes by this point in prior epochs is reported as having no vote-pace baseline at all — the same division would otherwise turn any votes at all into a nine-figure percentage. Like the reminder script, this sharpens as the epoch progresses and is noisiest early on.

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

### Arc

Circle's Arc mainnet (chain ID `5042`, EVM-compatible, gas paid in USDC) launched 2026-09-16, and "Aero" — Aerodrome and Velodrome's planned merged protocol — is named as a launch trading-infrastructure partner. As of this writing, no Sugar/Voter/veAERO-equivalent contract addresses on Arc have been published anywhere (checked Arc's own contract-address docs and `aerodrome-finance/contracts` on GitHub), and it's not yet clear whether voting stays Base-hub-only or becomes Arc-local — so there's nothing here to build against yet. Tracked as a roadmap item once addresses and an ABI are public.

## Configuration (env)

| Var | Default | |
|---|---|---|
| `AERO_PROTOCOL` | `aerodrome` | `aerodrome` (Base) or `velodrome` (Optimism) — see [Multi-protocol](#multi-protocol-aerodrome--velodrome) |
| `RPC_URL` | protocol default | Dedicated RPC, either protocol — always wins if set |
| `BASE_RPC_URL` | `https://base-rpc.publicnode.com` | Legacy alias for `RPC_URL`, honored when `AERO_PROTOCOL=aerodrome` |
| `RPC_URL_FALLBACK` | protocol default | Automatic failover if `RPC_URL` goes down (not just rate-limited) — a second, independently-operated public RPC per protocol; override if you have a dedicated backup |
| `AERO_MIN_TVL_USD` | `50000` | Candidate pool TVL floor |
| `AERO_MAX_CANDIDATES` | `300` | Pools receiving full epoch-history analysis, ranked by staked TVL. Comfortably above the ~260 pools that currently clear `AERO_MIN_TVL_USD` — a lower value silently excludes small-but-high-APR pools from every ranked tool, regardless of how good their yield is |
| `AERO_BACKTEST_EPOCHS` | `26` | Epochs of history pulled per pool for `backtest_summary` |
| `AERO_BACKTEST_MAX_POOLS` | `30` | Pools analyzed per default `backtest_summary` run |
| `AERO_DISCORD_WEBHOOK_URL` | unset | If set, `npm run epoch-reminder` also posts its summary to this Discord webhook — see [Epoch reminders](#epoch-reminders) |
| `AERO_VOTING_POWER` | unset | Your veAERO amount — if set, the epoch-reminder Discord post includes your personal `voter_roi` split, not just the market-wide reference — see [One-click voting from the alert](#one-click-voting-from-the-alert) |
| `NEXT_PUBLIC_SITE_URL` | `https://aeroallocator.app` on Aerodrome, unset otherwise | Public address of a `web/` deployment, for the link-preview image (`og:image`). Unset on a non-Aerodrome deployment means no preview image |
| `AERO_DASHBOARD_URL` | unset | Your dashboard deployment's URL. **Required by `npm run vote-alerts`**, which reads its `/api/dashboard`. For the epoch reminder it's optional: if also set, the Discord post links straight into it with that allocation pre-loaded |

## Epoch reminders

`npm run epoch-reminder` (`scripts/epoch-reminder.ts`) prints time-to-flip, the biggest predictive-edge
mispricings, any `detect_vote_swings` signals, and a `protocol_efficiency` reference allocation — a
snapshot of what's worth re-voting into or out of before lock. Set `AERO_DISCORD_WEBHOOK_URL` and it also
posts the same summary as a Discord embed, so this is actionable without anyone polling for it.

`.github/workflows/epoch-reminder.yml` runs it on a schedule three times in the final hours before each
epoch's Thursday 00:00 UTC lock (12h, 6h, and 1.5h out) via `workflow_dispatch`-triggerable cron. Set the
`AERO_DISCORD_WEBHOOK_URL` repo secret (and optionally `RPC_URL`, for a dedicated endpoint instead of the
public default) to enable it on your fork.

### One-click voting from the alert

Set `AERO_VOTING_POWER` (your veAERO amount) and the post also includes your personal `voter_roi` split,
not just the market-wide `protocol_efficiency` reference. Set `AERO_DASHBOARD_URL` too (your dashboard
deployment's URL) and the alert becomes a clickable link straight into it with that allocation pre-loaded
(via the `?vp=` param — see [Deploying to Vercel](#deploying-to-vercel)), wallet-connect ready.

This is deliberately "prepare + one-click approve," not unattended signing — no private key is ever held
by this script, the GitHub Actions workflow, or any server. You still connect your own wallet and confirm
the transaction yourself; automation only removes the "remember to check and compute this every week"
part, not the signing.

### Realized performance tracking

Every time `epoch-reminder` runs with `AERO_VOTING_POWER` set, it also logs that `voter_roi`
recommendation to `data/voter-roi-log.jsonl` — one entry per epoch (idempotently overwritten across the
schedule's three runs, so the log always reflects whichever run was closest to lock, the most accurate
one). `.github/workflows/epoch-reminder.yml` commits this file back to the repo automatically when it
changes.

`npm run realized-performance` (or the `realized_performance` MCP tool) then compares each logged epoch
that's since completed against what actually happened: realized reward per pool uses the *exact same*
formula `recommend_allocation` used to predict it — `R·v/(E+v)` — just with the epoch's final, actual
fees/bribes/votes instead of forecasts. This needs no new on-chain fetching: the pool's actual outcome for
any given epoch is already sitting in the same `RewardsSugar.epochsByAddress` history the engine reads for
everything else — as long as reconciliation happens within that history's 8-epoch window of the epoch
completing (`SETTINGS.historyEpochs`, not currently env-configurable), not months later.

This is a different question from `backtest_summary`: that validates the *forecast model* by replaying
history; this is a track record of *your actual recommendations* going forward. One caveat: the tool
can't know whether you actually followed a given logged recommendation — the "actual votes" figure it
reconciles against is the pool's whole recorded total for that epoch, which may or may not already
include yours.

### Vote alerts

`npm run vote-alerts` (`scripts/vote-alerts.ts`) is the mid-week counterpart to the reminder: it reads
your `voter_roi` split from the deployed dashboard's `/api/dashboard` (served from the shared snapshot
cache, so it needs no RPC key), compares it with its last reading, and posts to Discord **only** when a
pool in that split took at least 2x its votes (and at least 10,000 veAERO more), or its edge flipped
sign past a ±0.05pp deadband. The first run of an epoch has nothing to compare with and never alerts.
Without `AERO_DISCORD_WEBHOOK_URL` it just prints what it would have sent.

`.github/workflows/vote-alerts.yml` runs it hourly, keeping the last reading in the Actions cache. It's
off until you set the repo variable `AERO_ALERTS_ENABLED=true` (plus `AERO_DASHBOARD_URL` and the
`AERO_DISCORD_WEBHOOK_URL` / `AERO_VOTING_POWER` secrets the reminder already uses). `AERO_ALERT_MIN_VOTES`
raises the smallest vote growth that can alert; `AERO_ALERT_STATE_PATH` moves the state file.

To check the Discord connection without waiting for a real event, run the workflow by hand with
**send_test** ticked (or `AERO_ALERT_TEST=true npm run vote-alerts`): it posts one "connected" line and
fails loudly if the webhook isn't set. A test run leaves the saved reading alone.

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
- [x] x402-monetized hosted endpoints — `/api/v1/position` (per-wallet vote delta) and `/api/v1/forecast`, pay-per-call in USDC on Base, see [Paid API (x402)](#paid-api-x402)
- [x] "Predicted hot pools" dashboard (`web/`)
- [x] Wallet connection + one-click vote from the dashboard (wagmi)
- [x] Multi-protocol: Velodrome (Optimism) alongside Aerodrome (Base), selected via `AERO_PROTOCOL`
- [x] Dashboard (`web/`) multi-protocol support — one protocol-fixed deployment per protocol (the cross-linking switcher was retired with the hosted Velodrome site, 2026-09-24)
- [x] Dashboard deployed live on Vercel (Aerodrome; the hosted Velodrome deployment was retired 2026-09-24) — see [Deploying to Vercel](#deploying-to-vercel)
- [x] Semi-automated voting: epoch-reminder posts your personal split with a one-click approve link — see [One-click voting from the alert](#one-click-voting-from-the-alert)
- [x] Realized-vs-recommended tracking: `realized_performance` compares logged recommendations against actual outcomes — see [Realized performance tracking](#realized-performance-tracking)
- [x] Personal vote desk: dashboard shows your actual on-chain vote split next to the recommendation, with the $ difference
- [x] Multi-veNFT batch voting: every detected veNFT selected by default, cast as one Multicall3 transaction instead of one wallet signature per lock
- [x] Gas hurdle for small `votingPowerVe`: pools too small a slice to be worth the extra calldata are collapsed away instead of splitting into an N-way vote nobody can profit from
- [x] Vote mode: hot-pools table defaults to edge sort and a trimmed column set, with the rest folded into the row expand
- [x] Mobile row-expand parity, tighter confidence-cluster threshold, a gas-hurdle empty state, and a grouped (status vs actions) header
- [x] Vote-first information architecture: Voter ROI leads with an expected-$ headline, other objectives collapse behind "Other splits", sticky header, phone tabs (vote / LP / swings), and real empty states
- [x] First screen answers without a wallet: type an amount or paste an address, copy whole-percent weights that sum to 100, open Aerodrome; connect only to cast. Phone tabs are Vote / Pools / More, and "Other objectives", LP, swings, bribe sim and accuracy are collapsed
- [x] Read-only address lookup: veNFTs summed via `VeSugar.byAccount` from the browser over the public RPC, filling the amount and the current-vs-recommended comparison (the address never reaches our server)
- [x] Share text and a 1200×630 share card (`/api/share`), also used as the site's link preview
- [x] Vote alerts: hourly check of your split for a pool that took 2x its votes or whose edge flipped, to Discord (opt-in workflow) — see [Vote alerts](#vote-alerts)
- [ ] A published track record for the split itself (this split vs one top pool over settled epochs) — prototyped 2026-09-25 and held: on live data the split trailed a single top pool for holders under ~100k veAERO over 5 epochs, so it needs an engine look and more than the 8 weeks of history the snapshot holds
- [ ] Arc chain support — blocked on Aero/Dromos Labs publishing Sugar/Voter contract addresses on Arc; see [Arc](#arc)

## Disclaimer

Forecasts are statistical extrapolations of onchain history, not financial advice. Always review calldata before signing.
