---
name: veaero-to-saero-upgrade
description: "Check a wallet's old veAERO locks against Aero's migration contract on Base and, only when the owner confirms, prepare the two unsigned transactions that upgrade a lock to sAERO. Shows what each lock becomes (an expired lock becomes liquid AERO, not a sAERO position), what blocks it (votes, Relay, restricted list), and what must be claimed first. Read-only: never signs or sends, and the upgrade is irreversible. Verified against Aero's public contracts and a fork of Base."
metadata:
  emoji: ✈️
  homepage: https://aeroallocator.app
  category: defi-migration
  chain: base
---

# veAERO to sAERO upgrade

Aero (the merged Aerodrome and Velodrome) replaced veAERO with sAERO on 2026-10-22. Old veAERO locks do not convert by themselves: the owner upgrades each lock through Aero's migration contract. This skill checks what an upgrade would do and builds the transactions. **It never signs or sends anything, and an upgrade cannot be undone.**

## The facts it relies on (from Aero's own repo and a fork test, 2026-10-27)

- Migration contract on Base: `0x22a2F7340a3fB4C7C389D91eE954766B12476721` (Aero's `deployment-addresses/migration-base.json`). Old veAERO escrow `0xebf418Fe2512e7E6bd9b87a8F0f294aCDC67e6B4`; new sAERO escrow `0xBF7977E1521e9a3032bf7243Ee4712f311f13915`.
- `depositVeNFT(tokenId, recipient)` reverts unless the caller owns the lock, the lock is a normal one (not held in a Relay), has no active votes, is not on Aero's restricted list, and holds something, and the migration contract still has budget. The owner of the migration contract can pause it.
- The migration contract must first be **approved** on the lock (`approve(migration, tokenId)` on the old escrow). Without it the deposit reverts with `NotApprovedOrOwner`; this was reproduced on a fork.
- The conversion is **1:1 on the AERO locked**:
  - a **permanent** lock becomes a permanent sAERO position;
  - an **active** lock becomes a sAERO position with its remaining time rounded **up** to whole weeks (capped at the maximum);
  - an **expired** lock becomes **liquid AERO**, not a sAERO position, and has no allocation power until it is staked again.
- On a fork of Base, as the owner of a real lock: approve, then deposit, succeeded; the old lock was burned and a new sAERO position was minted to the owner (about 1.08M gas, cents on Base).
- Anything not claimed first (trading fees, incentives, the rebase) **is not carried over**.

## The flow

1. **Check (free, read-only):** `node scripts/check.mjs --address 0x…` lists the wallet's old locks, what each would become, and every blocker. Add `--json` for machine-readable output.
2. **Fix blockers first, outside this skill:**
   - *In a Relay:* the check lists it as blocked. Take it out of the Relay from the Relay's page.
   - *In a vault or lending market:* the NFT is owned by that contract, not by the wallet, so the check cannot list it. Get it back to the owner's wallet first.
   - *Active votes:* reset them (allowed only after the weekly epoch flips); Aero's Upgrade Hub walks through it.
   - *Rewards:* claim trading fees, incentives and the rebase on each lock in Aero's app. This skill does not build claims. Do not skip this: it is the one step that loses money if forgotten.
3. **Show the owner the preview and ask.** For each lock: the AERO amount, the outcome (sAERO until a date, permanent sAERO, or liquid AERO), the recipient, and the warnings. Wait for an explicit yes **for that lock**; a yes to "check my wallet" is not a yes to upgrade.
4. **Build the transactions:** `node scripts/check.mjs --address 0x… --tx` prints, for each ready lock, the unsigned `approve` (skipped if already approved) and `depositVeNFT`, both with value 0 on chain 8453. The recipient defaults to the owner; set `--recipient` only if the owner asked, and say so out loud.
5. **Hand them to the owner's wallet layer** to simulate, show and sign, in order: approve, wait for it to confirm, then deposit. Stop if either simulation fails.
6. **Confirm afterwards:** the old lock no longer exists (its `ownerOf` reverts or is zero), and a new sAERO position appears for the recipient (https://aeroallocator.app, "Your sAERO positions", or Aero's app).

## Rules for the agent

- Never sign or send with a key this skill touches, and never put a private key into it or its scripts.
- Never skip step 3. Never batch several locks into one yes.
- Never change a transaction's target or calldata. They must go to the two contracts above with value 0.
- If the owner is unsure about claiming, send them to Aero's Upgrade Hub (`https://aero.xyz/aero-upgrade/`) rather than guessing; it is the official walkthrough.
- An expired lock turning into liquid AERO may not be what the owner wants: say so before they confirm.
- After upgrading, the position can be allocated; the companion skill `saero-allocator-automator` and https://aeroallocator.app show where it earns the most.
- Not financial or tax advice.

## Files

- `scripts/check.mjs`: the read-only checker and transaction builder (Node 22, no dependencies, public Base RPC by default, `--rpc` to change it).
- `scripts/upgrade.mjs`: the rules and the calldata, with no network; `scripts/upgrade.test.mjs` checks every selector and the calldata against viem and covers each outcome and blocker.

## Example requests

- "Check my wallet for veAERO locks I can still upgrade, and tell me what each becomes. Don't send anything."
- "Lock 15308 is ready: show me the approve and deposit transactions and wait for my yes."
- "Why can't I upgrade this lock?" (the checker names every blocker)
