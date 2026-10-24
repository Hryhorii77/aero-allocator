# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

An MCP server (`src/`) that forecasts next-epoch pool demand for Aerodrome (Base) / Velodrome (Optimism) and recommends weekly vote/incentive allocations (the weekly-vote toolset, kept as it was), plus the Next.js site in `web/` — https://aeroallocator.app, the **sAERO allocator**: which Aero gauges pay the most per day for an amount, the owner's sAERO positions, allocate and return-to-idle from the wallet. Aero replaced weekly voting with continuous sAERO allocation on 2026-10-22 and Velodrome merged into it, so the weekly-vote dashboard, its free and paid (x402) APIs and the vote-alert / epoch-reminder schedules were removed from `web/` and CI on 2026-10-24. `web/` still imports the engine for `config` and `prices` only. It never holds keys; the allocate flow signs in the user's own wallet. `README.md` documents the MCP tools, the forecast model and the env vars in depth (much of it describes the weekly-vote era).

## Commands

Root (engine, Node 22, ESM TypeScript):

```bash
npm run typecheck                  # tsc --noEmit AND tsconfig.scripts.json (both must pass)
npm test                           # vitest run
npx vitest run src/scoring.test.ts # one file; add -t "name" for one test
npm run build                      # tsc -p tsconfig.build.json -> dist/
npm run dev                        # MCP server over stdio (tsx src/index.ts)
npm run smoke                      # LIVE end-to-end check against Base mainnet
```

`web/` (separate `package.json` and lockfile; run from `web/`): `npm run dev`, `npm test`, `npx tsc --noEmit`, `npm run build`.

Scripts (`scripts/*.ts`, run via `npm run backtest | epoch-reminder | realized-performance | lockers`) hit the live chain.

Before proposing a push or deploy, use the `verify` skill (typecheck/test/build for both packages in order, secret scan, audit). CI (`.github/workflows/ci.yml`) runs the same sequence.

## Architecture

**`web/` consumes the engine as compiled `dist/`, not `src/`.** `web/package.json` has `"aero-allocator": "file:.."`, and the root `exports` map points at `dist/*.js`. After changing anything in `src/`, run `npm run build` at the root; otherwise web tests and builds pass while running stale engine code. Root `dist/` is gitignored.

Engine flow (`src/`): `config.ts` (protocol preset, addresses, `SETTINGS`, epoch math) -> `data.ts` (viem client with RPC failover, reads the Sugar contracts, `abi.ts`) -> `prices.ts` (USD pricing) -> `scoring.ts` (EWMA+trend forecast, `getMarketSnapshot`, the three allocation objectives, bribe simulator, LP yield, vote swings) -> `index.ts` (MCP tool registration; tool descriptions are generated once at startup for the active protocol). `backtest.ts` feeds confidence calibration back into the live forecasts. `tracking*.ts` log and score past `voter_roi` recommendations.

- **One process = one protocol** (MCP server), chosen at startup by `AERO_PROTOCOL`; `web/` is Aero on Base only (`web/lib/protocol.ts`). Contract addresses for the wallet flow come from the server's `PRESET` via `/api/protocol`, never client-side.
- **Predictive Allocation is behind `src/adapters/predictive-allocation.ts`**, configured entirely by env vars (positional arg roles). `prepare_vote_calldata` still targets the classic `Voter.vote()`, which Aero retired; the live allocate flow is `web/lib/allocate.ts` (`allocate()` on Aero's Voter).
- **Web API** (`web/app/api/*`): `gauges` (gauge list per Aero chain), `gauge-fees` (+ `gauge-fees/ingest`, run by the six Vercel Crons in `web/vercel.json`, which keep the per-chain fee ledger in a Blob), `allocation-fee` (read-only live quote of the ETH an allocation to another chain needs), `protocol` (addresses), the paid x402 routes `v1/position` and `v1/allocate-plan` (handlers in `web/lib/v1-position.ts` / `v1-allocate-plan.ts`, wiring in `web/lib/x402.ts`; they serve 501 unless `X402_PAYTO_ADDRESS`, `CDP_API_KEY_ID` and `CDP_API_KEY_SECRET` are all set; keep new paid routes to answers the free reads can't give, and validate input with a 400 before any read so a bad call is never charged), and `share` (the sAERO share card; bump `SHARE_CARD_VERSION` in `web/lib/site.ts` when the card changes so link previews refetch it). Verify data-backed changes through the running dev server. `/llms.txt` (`web/lib/llms-txt.ts`) describes the free and paid endpoints for agents; keep its prices tied to the route constants. `vitest.config.mts` inlines `@x402/next` so tests can run the real payment flow with a stub facilitator.
- Address lookup reads the owner's sAERO positions in the browser, so the address never reaches the server.
- **Web UI conventions** (`web/app/ui.tsx`, `globals.css`): buttons, chips and links go through `btn()`, `chip()` and `LINK`, never ad-hoc class strings. Light mode works by mirroring the Tailwind scales (shade 50 <-> 950) under `[data-theme="light"]`, so new colors must come from `neutral`, `sky`, `emerald`, `rose`, `amber` or `violet`; any other family or a hardcoded hex stays dark-themed in light mode. Sky = primary/selected, emerald/rose = positive/negative money only, amber = caution. Tips (`tip-jar.tsx`) are USDC on Base to a fixed public address; the app itself stays free. The product name comes from `DISPLAY_PRESET.appName` ("Aero Allocator"), never `displayName` + "Allocator".
- **Phone layout**: phone-first single page (`saero-page.tsx`) with a sticky jump bar (`jump-bar.tsx`) to Gauges / Positions / Upgrade guide; the gauge table shows two columns on a phone with the rest under the pool name. Keep one wallet button (the header's): `app/page.test.tsx` asserts it.

## Gotchas

- Mobile overflow: a `grid` with no explicit columns sizes its track to its content, so a wide child pushes the whole page sideways on iPhone. Use `grid-cols-[minmax(0,1fr)]` for single-column card grids. Don't make the Pools filter chips scroll sideways; they wrap.
- Checking phone layouts: resizing the browser window does not change the page's CSS width. Load the app in a same-origin `<iframe>` of 360-402px (a temporary `public/*.html` page, with `X-Frame-Options` set to SAMEORIGIN only while testing, then restore DENY and delete the page) and measure with `getBoundingClientRect`. The real wallet apps can't be tested in the iOS Simulator; use a real phone.
- Security headers live in `web/next.config.ts` (nosniff, referrer, frame DENY, permissions, HSTS). There is deliberately no CSP yet: wallet dialogs, WalletConnect and the inline theme script need a tuned policy, and a wrong one silently stops wallets connecting.
- Don't add RainbowKit: its latest release (2.2.x) peer-requires wagmi 2 and `web/` is on wagmi 3. The wallet dialog and account panel (`wallet-modal.tsx`, `wallet.tsx`) are built directly on wagmi connectors. The WalletConnect connector exists only when `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` is set (with a placeholder id its relay socket churns and hangs the tab); on a phone with no injected provider "connect wallet" opens WalletConnect's own wallet window directly (no list): the Coinbase SDK connector only opened the Coinbase app's home screen, and a Coinbase deep-link hop was tried and rejected by the user.
- `web/` uses a Next.js version with breaking changes: read `web/AGENTS.md` (imported by `web/CLAUDE.md`) and the docs in `web/node_modules/next/dist/docs/` before writing web code.
- `.claude/`, `.agents/`, `skills-lock.json` and `.env*` are gitignored, so project skills and `settings.local.json` are local to this machine.
- Aero (the Aerodrome+Velodrome merger) launched 2026-10-22 00:00 UTC. Allocation amounts are voting power (not staked amount); the Voter, sAERO escrow and per-chain leaf voters are in `web/lib/saero.ts` and `web/lib/allocate.ts`. Allocating off Base is not built (the fee quote is; see `web/lib/allocate-fee.ts`). `docs/aero-launch-readiness.md` is the pre-launch research.
