# Aero launch readiness

Working notes for when Aero's docs and addresses go public. Written 2026-09-26
from Aero's articles and the two public contract repos; **re-verify against the
sources before acting** (the article text was read through a page summary, the
contracts were read directly). Nothing here is a commitment to a design.

## What is known

Sources: [Launch update](https://aero.xyz/articles/aero-launch-update-all-systems-go/),
[Predictive Allocation FAQ](https://aero.xyz/articles/aero-predictive-allocation-faq/),
[Aero Lite on Arc](https://aero.xyz/articles/aero-lite-is-live-on-arc/),
[Dromos-Labs on GitHub](https://github.com/Dromos-Labs) (`metadex-public`,
`metadex-slipstream-public`).

- **Launch:** October 21, 2026, 8:00 PM EDT = **October 22, 00:00 UTC** (a
  Thursday, where our weekly epochs flip).
- **Chains at launch (7):** Base, Ethereum, Robinhood Chain, Arc, OP Mainnet,
  Arbitrum, Ink. Aero Lite has been live on Arc since 2026-09-16 (pools + swaps
  + LP rewards; no veAERO-style voting or Predictive Allocation stated).
- **Voting is replaced.** FAQ: "Instead of token operators voting once weekly to
  direct the following week's rewards, they will allocate AERO rewards that
  stream to pools in real time." Allocation is "concurrent, continuous, and
  cross-chain", with "a minimum of 48 hours before being able to change their
  allocations" per sAERO position, and **Gauge Caps** so rewards go to a pool
  only "unless a set level of fees actually materialize".
- **Everything is upgraded.** "All AERO, veAERO, VELO, and veVELO will need to
  be upgraded to the new AERO and sAERO tokens"; new NFT ids are minted;
  positions must be withdrawn first.
- **Not stated anywhere yet:** deployment addresses (the repo's
  `deployment-addresses/` is empty), an SDK or docs link, migration steps and
  timing, how bribes/incentives map onto streaming, gauge-cap rules, fee
  percentages, any API for reading allocation state.
- **The Voter contract is public** (`V3/src/voter/Voter.sol`, `LeafVoter.sol`;
  a root-chain hub plus per-chain leaves). It has **no `vote()`**. Allocation is:
  `allocate(tokenId, ChainAllocationDispatch[], GaugeAllocationDispatch[], refundRecipient)`
  (payable), plus `allocateChains` / `allocateGauges`, where a gauge allocation is
  `{gauge, uint128 allocated, bytes data}` (an absolute amount, not a relative
  weight), a chain dispatch is `{chainId, delta, gasLimit, value}`, and there are
  cooldowns (`reduceCooldown`) and message lifetimes. No Sugar-style reader
  contracts are in either repo.

## What this means for this repo

| Area | Today | Likely to break because |
|---|---|---|
| `web/lib/voter.ts`, `wallet.tsx` (cast, copy calldata, multicall) | `Voter.vote(tokenId, pools, relative weights)` | new Voter has no `vote`; allocations are absolute amounts, cross-chain, payable |
| "Copy weights" (whole % summing to 100) | typed into Aerodrome's vote screen | allocation UI/semantics change; percentages may not be the unit |
| `src/adapters/predictive-allocation.ts` | one configured function, positional args from pool + weight | published shape is struct arrays + payable value; **not** an env-var-only change |
| `src/data.ts`, `src/lockers.ts`, `src/abi.ts` | VeSugar / RewardsSugar / LpSugar reads, per-epoch history | no Sugar in the new repos; history is epoch-based, allocation is streaming |
| `src/scoring.ts` (`R·v/(E+v)`, water-fill, 35% cap) | pays out per weekly epoch from fees+bribes over votes | streaming rewards, 48h windows and gauge caps change the payout model |
| `src/config.ts` PRESET / one protocol+chain per deployment | Base (Aerodrome), Optimism (Velodrome) | seven chains; a cross-chain snapshot is a new project |
| header clock, "votes close in", `epoch-reminder`, `vote-alerts` | weekly lock one hour before the flip | no weekly epoch to count to |
| `/api/v1/position`, `/api/v1/bribe-target`, MCP tools | veNFT locks and gauge votes | inputs and meaning change |

**What likely carries over:** the fee-demand forecast (the FAQ's whole premise
is prediction, and gauge caps are literally "fees must materialize"), the
dollar-first framing, the read-only lookup, the share card, the x402 shell.

## When the docs and addresses land, read in this order

1. **Addresses** per chain: does `deployment-addresses/` fill in, and for which chains?
2. **Migration guidance for veNFT holders**: is there a transition where the old
   `Voter.vote()` still works, or a hard cutover at launch? This decides everything below.
3. **The allocation ABI as deployed** (compare with the source above), the
   sAERO position model, the 48h window, and how gas/`value` is quoted.
4. **A read path**: SDK, subgraph or reader contracts. Without one, forecasting
   needs its own indexer of gauge fee streams.
5. **How incentives stream** and how gauge caps are set (governance, fixed, dynamic).

## Does the veAERO flow survive? Decision tests

- Old Aerodrome Voter still accepts `vote()` after launch for veNFT holders?
  **Yes for a transition period** -> keep the current flow, add a clear
  end-date notice. **No** -> hard cutover, plan the rebuild.
- Do sAERO positions have ids we can read per address (our lookup depends on it)?
- Is there any read of per-gauge fees over time (our forecast depends on it)?
- Is the unit of allocation an amount, a percentage, or both?

## Cheap preparation that is safe now

- Keep the launch notice (it cites the FAQ and disappears at the launch instant).
- Make the "next epoch" and "votes close in" wording generic enough to retire
  without a rewrite.
- Spike (no product change): can fee history per gauge be read from the
  published contracts' events, independent of any Sugar?
- Do **not** build against `allocate` yet: addresses, migration and read paths
  are all unpublished, and the shape may change before launch.
