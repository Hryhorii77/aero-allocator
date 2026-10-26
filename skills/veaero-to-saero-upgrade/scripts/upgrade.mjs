// The logic of the veaero-to-saero-upgrade skill: no dependencies, no network, nothing signed. `check.mjs` feeds it chain reads.
// Contract facts are from Aero's own public repo (dromos-labs/metadex-public: V3/src/migration, deployment-addresses/migration-base.json)
// and were exercised on a fork of Base as the owner of a real lock.

/** Aero's AerodromeMigration on Base. */
export const MIGRATION = "0x22a2F7340a3fB4C7C389D91eE954766B12476721";
/** The old veAERO VotingEscrow (the lock NFTs being upgraded) and the new sAERO escrow they become positions in. */
export const OLD_ESCROW = "0xebf418Fe2512e7E6bd9b87a8F0f294aCDC67e6B4";
export const NEW_ESCROW = "0xBF7977E1521e9a3032bf7243Ee4712f311f13915";

/** 4-byte selectors (checked against viem in the tests). */
export const SEL = {
  balanceOf: "0x70a08231",
  ownerToNFTokenIdList: "0x8bf9d84c",
  ownerOf: "0x6352211e",
  locked: "0xb45a3c0e",
  voted: "0x8fbb38ff",
  escrowType: "0x7c728000",
  restricted: "0x3b17b94b",
  previewConversion: "0x70421ab9",
  paused: "0x5c975abb",
  migrationOpen: "0x2308c97a",
  remaining: "0x55234ec0",
  getApproved: "0x081812fc",
  isApprovedForAll: "0xe985e9c5",
  approve: "0x095ea7b3",
  depositVeNFT: "0xc0ddab40",
};

const word = (hex) => hex.replace(/^0x/, "").toLowerCase().padStart(64, "0");
export const encodeUint = (n) => word(BigInt(n).toString(16));
export const encodeAddress = (a) => word(a);
export const call = (selector, ...args) => selector + args.join("");

/** Splits an eth_call result into 32-byte words. */
export const words = (hex) => (hex.replace(/^0x/, "").match(/.{64}/g) ?? []).map((w) => "0x" + w);
export const toBig = (w) => BigInt(w);
/** A signed 128-bit value stored in a 32-byte word (the lock amount is an int128). */
export const toInt128 = (w) => {
  const v = BigInt(w) & ((1n << 128n) - 1n);
  return v >= 1n << 127n ? v - (1n << 128n) : v;
};
export const toAddress = (w) => "0x" + w.slice(-40);

/**
 * The two unsigned transactions that upgrade one lock: approve the migration contract on the old escrow, then depositVeNFT.
 * `value` is "0" for both (the contract reverts on any ETH). Order matters: the deposit reverts with NotApprovedOrOwner without the approval.
 */
export function buildTxs(tokenId, recipient, { needsApproval = true } = {}) {
  const txs = [];
  if (needsApproval) {
    txs.push({ step: "approve", to: OLD_ESCROW, data: call(SEL.approve, encodeAddress(MIGRATION), encodeUint(tokenId)), value: "0", chainId: 8453, what: `Let Aero's migration contract take lock #${tokenId}.` });
  }
  txs.push({ step: "depositVeNFT", to: MIGRATION, data: call(SEL.depositVeNFT, encodeUint(tokenId), encodeAddress(recipient)), value: "0", chainId: 8453, what: `Upgrade lock #${tokenId}: it is burned and ${recipient} receives the result. Irreversible.` });
  return txs;
}

/**
 * What would happen to one lock, from the reads. Returns { status: "ready" | "blocked", blockers, outcome, warnings }.
 *   token:     { tokenId, owner, locked: { amount, end, isPermanent }, voted, escrowType, restricted, preview: { out, isPermanent, isLiquid } | null }
 *   migration: { paused, open, remaining, now }
 * `blockers` are things that make depositVeNFT revert (or that Aero's own checklist says to fix first); fix them, do not work around them.
 */
export function classify(token, migration) {
  const blockers = [];
  const { locked } = token;
  if (migration.paused) blockers.push("Aero's migration contract is paused right now.");
  if (migration.now < migration.open) blockers.push("The migration has not opened yet.");
  if (token.restricted) blockers.push("Aero has put this lock on its restricted list; it cannot be migrated through the contract.");
  if (token.escrowType !== 0) blockers.push("This lock is held in a Relay (a managed lock). Take it out of the Relay to your own wallet first, on the Relay's page.");
  if (token.voted) blockers.push("This lock has active votes. Reset the votes first (a reset is only allowed after the weekly epoch flips; Aero's Upgrade Hub walks through it).");
  if (!(locked.amount > 0n)) blockers.push("Nothing is locked in it, so there is nothing to convert.");
  const out = token.preview ? token.preview.out : locked.amount;
  if (out > migration.remaining) blockers.push("Aero's migration budget is used up for an amount this size.");

  const expired = !locked.isPermanent && locked.end <= BigInt(migration.now);
  let outcome;
  if (locked.isPermanent) outcome = { kind: "sAERO", detail: "a permanent sAERO position", amount: out };
  else if (expired) outcome = { kind: "liquid", detail: "liquid AERO sent to the recipient, NOT a sAERO position (the lock has expired)", amount: out };
  else outcome = { kind: "sAERO", detail: `a sAERO position with the remaining lock time rounded up to whole weeks (the lock ends ${new Date(Number(locked.end) * 1000).toISOString().slice(0, 10)})`, amount: out };

  const warnings = [
    "Irreversible: the lock is burned and cannot be recovered.",
    "Claim trading fees, incentives and the rebase on this lock first: anything unclaimed is not carried over.",
  ];
  if (outcome.kind === "liquid") warnings.push("An expired lock becomes liquid AERO, which has no allocation power; stake it again afterwards if you want a sAERO position.");
  return { status: blockers.length ? "blocked" : "ready", blockers, outcome, warnings };
}

/** "123.456789" from 18-decimal base units. */
export function tokens(raw, decimals = 18, shown = 6) {
  const s = BigInt(raw).toString().padStart(decimals + 1, "0");
  const whole = s.slice(0, -decimals);
  const frac = s.slice(-decimals).slice(0, shown).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole;
}
