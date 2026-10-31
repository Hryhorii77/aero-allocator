---
name: saero-allocator-automator
description: "Keep a sAERO position on the Aero gauges that pay the most, without churning it. Once the 47-hour wait is over, check the position, decide with fixed rules (switch only for a real, steady gain, never for a one-off fee burst), fetch the unsigned allocate() transaction, check it, and hand it to the owner's wallet. Uses aeroallocator.app (pay-per-call x402 endpoints, USDC on Base: position and allocate-plan, and cross-chain-plan to act across chains). Never signs or sends anything itself. Estimates, not financial advice."
metadata:
  emoji: ✈️
  homepage: https://aeroallocator.app
  category: defi-automation
  chain: base
---

# sAERO allocator automator

Aero (the merged Aerodrome and Velodrome) lets a sAERO position be re-allocated across gauges, then locks that position for a wait (47 hours at launch, read live from the chain) before the next change. Fees and incentives flow to wherever the position was allocated, so the job is: **move when it is worth it, stay otherwise.** This skill is that loop. Service: https://aeroallocator.app (description for agents: `/llms.txt`, machine-readable: `/openapi.json`).

## What it needs

- The position's owner: a wallet address (all its sAERO positions) or one `tokenId`.
- A wallet layer that can **simulate, show and sign** a Base transaction for the owner. This skill only produces the unsigned transaction.
- Optionally a small payer wallet with a little USDC on Base to pay the two API calls: **$0.05** for the position check, **$0.10** for the plan. The payer key only pays for calls; keep it separate from the key that owns the position.
- No account or API key. A call that fails (400, 404, 422) is never charged.

## The loop (run it when the wait may be over, e.g. hourly; there is nothing to do inside the wait)

1. **Gauge fees (free):** `GET /api/gauge-fees?chain=8453`. Each gauge has `feesUsdPerDay`, `windowHours`, `steady`, and `spike` when its recent pace is a burst far above its usual level.
2. **Position (paid, $0.05):** `GET /api/v1/position?address=0x…` (or `?tokenId=…`). Look at `advice.action`, `advice.canActNow`, `advice.readyAt`, `confidence`, `gainUsdPerDay`, `bestSplit`.
3. **Decide** with the rules below (`scripts/decide.mjs`).
4. **If, and only if, every rule passes, plan (paid, $0.10):** `GET /api/v1/allocate-plan?tokenId=…&maxGauges=4`. It returns the unsigned `allocate()` call, already simulated as the owner.
5. **Check the plan** (`checkPlan` in `scripts/decide.mjs`), then give `transaction` to the owner's wallet layer to simulate again, show, and sign from `sendFrom`.
6. **Record the time you sent it.** The position cannot be changed again until the wait ends; do not re-plan before then.

Optional, read-only: `GET /api/top-gauges?chain=all&amount=<power>` (free) ranks every chain's gauges side by side (no cross-chain fee counted), and `GET /api/all-chains-split?amount=<power>&days=<n>` (free) says whether spreading the position over other chains would beat Base alone after the one-off ETH each extra chain costs. This loop only moves power on Base; to act on a cross-chain split, `GET /api/v1/cross-chain-plan?tokenId=…` ($0.25) returns the ordered unsigned steps, and the same checks apply (the owner confirms each one, nothing is signed here).

`scripts/run.mjs` does steps 1 to 5 in one pass and prints the unsigned transaction. `--dry` shows the free data and the prices and pays nothing.

## The rules (all must pass to act)

1. **The wait is over** (`advice.canActNow`). Otherwise wait until `advice.readyAt`.
2. **`advice.action` is `switch` or `allocate`.** `stay`, `unknown` and `none` mean do nothing. The service only says `switch` when the best split beats staying by at least 5% and $0.05/day and rests on at least 6 hours of fee history.
3. **`confidence` is `fair` or `solid`**, not `thin` (under 6 hours of fee history behind the weakest gauge).
4. **The gain is at least your own minimum** (`--min-gain`, default none beyond rule 2).
5. **No gauge in `bestSplit` is a burst** (`spike` on its `gauge-fees` entry). A pace several times a gauge's usual level is usually a one-off release; chasing it means paying the wait for a yield that will not last. Override only on purpose (`allowSpike`).
6. Note, but do not block on, patchy payouts (`steady.paying` under half of `steady.buckets`) and gauges with no fee record.

Why so strict: every allocation **replaces the whole Base distribution and restarts the wait**. Gas on Base is about a cent and does not matter; the wait is the real cost. Moving for a small or unsteady gain is a loss.

## Checks before anything is signed (`checkPlan`)

- `transaction.to` is Aero's Voter on Base, `0x49d7d4f17Ec56Ef8fA04E464AF5D1A4942CC31e6`, `chainId` is 8453, `value` is `"0"`, `data` is hex.
- `simulation.ok` is true (the service simulated it as the owner) and `sendFrom` is the owner.
- The plan's own `advice.action` is not `stay`.

If any check fails, do not send it and report why.

## Autonomy and safety

- **Default: show the owner the decision and the transaction, and ask.** Send without asking only if the owner has explicitly delegated that to this agent, within a limit they set (for example "move at most once per wait, only for gains of at least $X/day").
- Never put the owner's private key into this skill or its scripts. Never sign with the payer key.
- Never allocate to a gauge that is not in the plan; never edit the calldata.
- Do not describe the figures as a promise: fees are a recent pace, incentives end, and past pay does not predict the future. Not financial advice.
- The best split already spreads power across gauges when that earns more; do not collapse it into a single gauge unless the owner asks.

## Setup for the script

```bash
cd skills/saero-allocator-automator/scripts
npm i @x402/fetch @x402/evm viem            # only needed to pay; --dry needs nothing
node run.mjs --token-id 15308 --dry         # free: shows data and prices, pays nothing
PAYER_PRIVATE_KEY=0x… node run.mjs --address 0x…   # pays $0.05, and $0.10 only if a move passes every rule
```

`decide.mjs` has no dependencies and can be run or copied on its own: `node decide.mjs position.json gauge-fees.json [plan.json]`.

## Example requests

- "Check my sAERO positions and tell me if any should move. Don't send anything."
- "Every hour, check position 15308. If it can move and passes your rules, show me the transaction and ask."
- "I delegate position 15308 to you: move it at most once per wait, only for gains of at least $0.50 a day, and tell me each time."

Related: the root `SKILL.md` lists every free and paid endpoint.
