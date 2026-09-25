# aeroallocator.app — the dashboard

The Next.js app behind https://aeroallocator.app. It's a thin UI and a few API routes over the engine in
the repo root; the [root README](../README.md#dashboard) describes what the page does.

## Run it

`web/` imports the engine as **compiled** `dist/` (`file:..` in `package.json`), not from `src/`. After
changing anything under `../src`, rebuild the root first or `web/` silently runs the old engine:

```bash
npm run build          # in the repo root
cd web && npm install && npm run dev
```

The first load builds the onchain snapshot (up to ~1 minute), then it's cached.

## Layout

- `app/page.tsx` — the dashboard (Voter ROI card, hot pools, collapsed panels, phone tabs)
- `app/wallet.tsx` — connect button, address lookup, and the cast / copy-calldata panel
- `app/api/dashboard` — everything the page needs, from one snapshot build
- `app/api/share` — the 1200×630 share card (`?vp=<amount>`)
- `app/api/v1/*` — the paid x402 endpoints (`position`, `forecast`)
- `lib/` — snapshot caching, formatting (`format.ts`), link-preview metadata (`site.ts`), rate limits

## Environment

| Var | |
|---|---|
| `AERO_PROTOCOL` / `NEXT_PUBLIC_AERO_PROTOCOL` | `aerodrome` (default) or `velodrome`; set both to the same value |
| `NEXT_PUBLIC_SITE_URL` | This deployment's public address, for the link-preview image. Defaults to `https://aeroallocator.app` on Aerodrome; with none set, a non-Aerodrome deployment gets no preview image |

Everything else (RPC, x402, snapshot storage) is documented in the root README's configuration table.

## Checks

`npx tsc --noEmit`, `npm test`, `npm run build` — or run the repo's `verify` skill, which does root and
web in the right order.

This is a recent Next.js with breaking changes from older versions; see `AGENTS.md` before writing
framework code.
