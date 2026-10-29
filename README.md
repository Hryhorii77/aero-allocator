# aero-allocator

[![CI](https://github.com/Hryhorii77/aero-allocator/actions/workflows/ci.yml/badge.svg)](https://github.com/Hryhorii77/aero-allocator/actions/workflows/ci.yml)

**https://aeroallocator.app** is the sAERO allocator for [Aero](https://aero.xyz) (the merged Aerodrome and Velodrome, live since
2026-10-22): which gauges pay the most per day for your amount of sAERO, what your positions earn, and an allocate / return-to-idle
flow signed in your own wallet. It is free, has no accounts, and never holds keys. Figures are estimates from recent on-chain fee
releases, not financial advice.

This repository holds:

- **`web/`**: the Next.js site above, plus its free and paid (x402) APIs. This is the live product. Start with [The site](#the-site).
- **`skills/`**: two agent skills (re-allocate a position only when it is worth it; check or prepare a veAERO to sAERO upgrade). See [Agent skills](#agent-skills).
- **`scripts/`**: the CI audit gate. (The weekly-vote MCP engine that used to live in `src/` was removed after Aero replaced weekly voting; it is in git history, last present in commit `1f94d77`.)

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
cd web && npm install && npm run dev
```

Open http://localhost:3000. Checks, in `web/`: `npx tsc --noEmit`, `npm run lint`, `npm test`, `npm run build`; in the root: `npm install && npm run typecheck && npm test` (the skills' and the audit gate's tests), and `npx tsx scripts/audit-gate.ts .` and `... web` (CI runs all of them; the audit gate fails on any advisory except the one accepted advisory listed in `scripts/audit-gate.ts`).

History is kept by Vercel Cron: six crons (one per chain, `web/vercel.json`) call `/api/gauge-fees/ingest` every 30 minutes, which
extends the fee record (4 days), takes a weight snapshot (3 days) and, once a UTC day has finished, adds it to the daily record
(90 days). All three live in private Vercel Blobs. The route requires `CRON_SECRET` as a bearer token (Vercel Cron sends
it by itself); a deployed site without it refuses every call, so history stays empty until it is set.

### Environment (`web/`)

| Var | | |
|---|---|---|
| `RPC_URL`, `RPC_URL_FALLBACK` | optional | A dedicated RPC, and a second one for failover. Without them public nodes are used, which works but is slower and rate limited |
| `BLOB_READ_WRITE_TOKEN` | needed for history | Vercel Blob token for the fee, weight and daily records. Without it the site works but shows no history |
| `CRON_SECRET` | needed for history | Locks `/api/gauge-fees/ingest` to Vercel Cron; without it a deployed site refuses the cron's calls |
| `NEXT_PUBLIC_SITE_URL` | `https://aeroallocator.app` | Public address, for the link-preview image |
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | unset | Free [Reown Cloud](https://cloud.reown.com) project id (the domain must be on its allowlist). Enables WalletConnect; without it that connector is left out because its relay socket would hang the tab |
| `X402_PAYTO_ADDRESS`, `CDP_API_KEY_ID`, `CDP_API_KEY_SECRET` | for the paid routes | See [Paid API (x402)](#paid-api-x402) |

### Deploying to Vercel

The site lives in `web/`, which Vercel's zero-config detection doesn't find at the repo root, so the project needs a couple of non-default settings:

| Setting | Value | Why |
|---|---|---|
| Root Directory | `web` | Vercel's Next.js detection checks *this* directory's `package.json` for a `next` dependency; pointing it at the repo root (which has no `next` dep) fails detection entirely |
| Install Command | `npm install` (default) | Must be a real install, not a no-op: Vercel checks the installed Next.js version immediately after this step, before running Build Command |
| Build Command | default (`next build`) | The project may still carry the older `cd .. && npm install --include=dev && npm run build && cd web && npm run build` from when the site imported a root engine. It keeps working because the root `build` script is now a no-op; it can be reset to the default |
| Output Directory | default (`.next`) | Resolved *relative to Root Directory*: do not prefix with `web/` (that double-counts and fails with "output directory not found") |

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
Coinbase's CDP facilitator only after a successful answer (a 400/404/422 is never charged). The free site is unaffected.
All three are listed in Coinbase's x402 Bazaar (and so agentic.market): `position` and `allocate-plan` since their first settled payments on 2026-10-26, `cross-chain-plan` since its first on 2026-10-28 (the call that took three attempts: see the 500-character description limit in CLAUDE.md). They are described for agents at `/llms.txt` and `/openapi.json`.

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


## Roadmap

- [x] sAERO allocator: ranked gauges, best split, positions read in the browser, allocate and return-to-idle from your wallet
- [x] Fee pace measured from on-chain releases, with weight snapshots, power flow, steadiness, new-incentive flags and a 90-day daily record
- [x] Paid x402 endpoints for agents (`v1/position`, `v1/allocate-plan`, `v1/cross-chain-plan`), `/llms.txt` and `/openapi.json`, listed in the x402 Bazaar
- [x] Two agent skills: re-allocate a position only when it is worth it, and check or prepare a veAERO to sAERO upgrade (read-only, irreversible, verified against Aero's contracts)
- [x] A gauge whose fee pace is a burst is marked spiky and its APR shown as a range
- [x] Per-position wait explanation, calendar reminder, earned-fees read, Autopilot-key handling, and what staying costs per day
- [x] Allocating a position across chains (best split or your own percentages), returning power, moving it between chains and picking gauges inside a chain, each step simulated first; Arc is a seventh chain
- [x] A paid cross-chain plan for agents (`v1/cross-chain-plan`)
- [ ] Claiming rewards: not built, because Aero's claim is callable only by a position's operator or Aero's orchestrator
- [ ] A move-or-stay backtest: prototyped and dropped, the record was too short and fees too lumpy; retry with more of the daily record

## Disclaimer

Figures are estimates from recent onchain fee releases, not forecasts or financial advice. Always review a transaction in your wallet before signing it.
