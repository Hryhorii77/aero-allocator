# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

An MCP server (`src/`) that forecasts next-epoch pool demand for Aerodrome (Base) / Velodrome (Optimism) and recommends vote/incentive allocations, plus a Next.js dashboard and paid x402 API (`web/`) that reuses the engine. It never holds keys or signs; it only prepares unsigned calldata. `README.md` documents the tools, the forecast model and the env vars in depth.

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

Scripts (`scripts/*.ts`, run via `npm run backtest | epoch-reminder | realized-performance | lockers | vote-alerts`) hit the live chain. `vote-alerts` requires `AERO_DASHBOARD_URL`.

Before proposing a push or deploy, use the `verify` skill (typecheck/test/build for both packages in order, secret scan, audit). CI (`.github/workflows/ci.yml`) runs the same sequence.

## Architecture

**`web/` consumes the engine as compiled `dist/`, not `src/`.** `web/package.json` has `"aero-allocator": "file:.."`, and the root `exports` map points at `dist/*.js`. After changing anything in `src/`, run `npm run build` at the root; otherwise web tests and builds pass while running stale engine code. Root `dist/` is gitignored.

Engine flow (`src/`): `config.ts` (protocol preset, addresses, `SETTINGS`, epoch math) -> `data.ts` (viem client with RPC failover, reads the Sugar contracts, `abi.ts`) -> `prices.ts` (USD pricing) -> `scoring.ts` (EWMA+trend forecast, `getMarketSnapshot`, the three allocation objectives, bribe simulator, LP yield, vote swings) -> `index.ts` (MCP tool registration; tool descriptions are generated once at startup for the active protocol). `backtest.ts` feeds confidence calibration back into the live forecasts. `tracking*.ts` log and score past `voter_roi` recommendations.

- **One process = one protocol**, chosen at startup by `AERO_PROTOCOL`. The web app also fixes it at build time via `NEXT_PUBLIC_AERO_PROTOCOL`, which must match. Contract addresses for votes always come from the server's `PRESET` via `/api/protocol`, never client-side.
- **Predictive Allocation is behind `src/adapters/predictive-allocation.ts`**, configured entirely by env vars (positional arg roles). Today `prepare_vote_calldata` targets the classic `Voter.vote()`.
- **Web API** (`web/app/api/*`) serves the dashboard from a shared snapshot cache (`web/lib/snapshot.ts`, with a durable layer). A cold snapshot build takes about a minute, so verify data-backed changes through the running dev server (`/api/dashboard`) rather than a standalone script that triggers a cold scan. Paid routes under `web/app/api/v1/*` use `@x402/next` `withX402` and return `501` unless `X402_PAYTO_ADDRESS`, `CDP_API_KEY_ID` and `CDP_API_KEY_SECRET` are all set.
- Address lookup (`VeSugar.byAccount`) runs in the browser, so the address never reaches the server.

## Gotchas

- `web/` uses a Next.js version with breaking changes: read `web/AGENTS.md` (imported by `web/CLAUDE.md`) and the docs in `web/node_modules/next/dist/docs/` before writing web code.
- `.claude/`, `.agents/`, `skills-lock.json` and `.env*` are gitignored, so project skills and `settings.local.json` are local to this machine.
- Aero (the Aerodrome+Velodrome merger) launches 2026-10-22 00:00 UTC and replaces weekly `Voter.vote()` with continuous allocation. Don't build against the new `allocate()` until addresses and a read path are published; see `docs/aero-launch-readiness.md`.
