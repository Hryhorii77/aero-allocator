// Read-only check of a wallet's old veAERO locks against Aero's migration contract on Base: what each lock would become, what blocks it,
// and (with --tx) the unsigned approve + depositVeNFT transactions for the locks that are ready. It reads only; it NEVER signs or sends.
//
//   node check.mjs --address 0x…  [--recipient 0x…] [--tx] [--json] [--rpc https://mainnet.base.org]
//
// No dependencies (Node 22). The transactions are for the owner's wallet layer to simulate, show and sign; the owner must also have
// claimed fees, incentives and the rebase on each lock BEFORE depositing, because unclaimed rewards are not carried over.
import { MIGRATION, NEW_ESCROW, OLD_ESCROW, SEL, buildTxs, call, classify, encodeAddress, encodeUint, toAddress, toBig, toInt128, tokens, words } from "./upgrade.mjs";

const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const opt = (n, d) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : d);
const owner = opt("address");
if (!owner || !/^0x[0-9a-fA-F]{40}$/.test(owner)) {
  console.error("usage: node check.mjs --address 0x… [--recipient 0x…] [--tx] [--json] [--rpc URL]");
  process.exit(2);
}
const recipient = opt("recipient", owner);
if (!/^0x[0-9a-fA-F]{40}$/.test(recipient)) {
  console.error("--recipient must be a 0x… address");
  process.exit(2);
}
const rpc = opt("rpc", "https://mainnet.base.org");
const MAX_LOCKS = 50;

let id = 0;
// The public RPC drops or rate-limits bursts, so calls go through a small pool and are retried; a missing result is an error, never a zero.
let active = 0;
const waiting = [];
const MAX_PARALLEL = 6;
async function slot() {
  if (active >= MAX_PARALLEL) await new Promise((r) => waiting.push(r));
  active++;
}
function release() {
  active--;
  waiting.shift()?.();
}
async function rpcCall(method, params) {
  await slot();
  try {
    for (let attempt = 1; ; attempt++) {
      try {
        const res = await fetch(rpc, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }) });
        const body = await res.json();
        if (body.error) throw new Error(body.error.message);
        if (body.result === undefined || body.result === null) throw new Error(`the RPC returned no result (${JSON.stringify(body).slice(0, 120)})`);
        return body.result;
      } catch (e) {
        if (attempt >= 4 || /execution reverted/i.test(String(e?.message))) throw e;
        await new Promise((r) => setTimeout(r, 300 * attempt));
      }
    }
  } finally {
    release();
  }
}
const read = (to, data) => rpcCall("eth_call", [{ to, data }, "latest"]);

const [pausedHex, openHex, remainingHex, block] = await Promise.all([
  read(MIGRATION, SEL.paused),
  read(MIGRATION, SEL.migrationOpen),
  read(MIGRATION, SEL.remaining),
  rpcCall("eth_getBlockByNumber", ["latest", false]),
]);
const migration = { paused: toBig(pausedHex) !== 0n, open: Number(toBig(openHex)), remaining: toBig(remainingHex), now: Number(toBig(block.timestamp)) };

const count = Number(toBig(await read(OLD_ESCROW, call(SEL.balanceOf, encodeAddress(owner)))));
const ids = await Promise.all(Array.from({ length: Math.min(count, MAX_LOCKS) }, async (_, i) => toBig(await read(OLD_ESCROW, call(SEL.ownerToNFTokenIdList, encodeAddress(owner), encodeUint(i))))));

const results = [];
for (const tokenId of ids) {
  const arg = encodeUint(tokenId);
  const [lockedHex, votedHex, typeHex, restrictedHex, previewHex, approvedHex, allHex] = await Promise.all([
    read(OLD_ESCROW, call(SEL.locked, arg)),
    read(OLD_ESCROW, call(SEL.voted, arg)),
    read(OLD_ESCROW, call(SEL.escrowType, arg)),
    read(MIGRATION, call(SEL.restricted, arg)),
    read(MIGRATION, call(SEL.previewConversion, arg)).catch(() => null),
    read(OLD_ESCROW, call(SEL.getApproved, arg)),
    read(OLD_ESCROW, call(SEL.isApprovedForAll, encodeAddress(owner), encodeAddress(MIGRATION))),
  ]);
  const [amount, end, perm] = words(lockedHex);
  const pv = previewHex ? words(previewHex) : null;
  const token = {
    tokenId,
    owner,
    locked: { amount: toInt128(amount), end: toBig(end), isPermanent: toBig(perm) !== 0n },
    voted: toBig(votedHex) !== 0n,
    escrowType: Number(toBig(typeHex)),
    restricted: toBig(restrictedHex) !== 0n,
    preview: pv ? { out: toBig(pv[1]), isPermanent: toBig(pv[2]) !== 0n, isLiquid: toBig(pv[3]) !== 0n } : null,
  };
  const verdict = classify(token, migration);
  const approved = toAddress(approvedHex).toLowerCase() === MIGRATION.toLowerCase() || toBig(allHex) !== 0n;
  results.push({ token, verdict, txs: verdict.status === "ready" && flag("tx") ? buildTxs(tokenId, recipient, { needsApproval: !approved }) : undefined });
}

if (flag("json")) {
  console.log(JSON.stringify({ owner, recipient, migration: { ...migration, remaining: migration.remaining.toString() }, locks: results.map((r) => ({ tokenId: r.token.tokenId.toString(), amount: r.token.locked.amount.toString(), status: r.verdict.status, blockers: r.verdict.blockers, outcome: { ...r.verdict.outcome, amount: r.verdict.outcome.amount.toString() }, warnings: r.verdict.warnings, txs: r.txs })) }, null, 2));
} else {
  console.log(`Wallet ${owner}: ${count} old veAERO lock${count === 1 ? "" : "s"}${count > MAX_LOCKS ? ` (first ${MAX_LOCKS} checked)` : ""}. Migration ${migration.paused ? "PAUSED" : "open"}, ${tokens(migration.remaining)} AERO of budget left.`);
  if (recipient !== owner) console.log(`NOTE: the result would go to ${recipient}, not to the owner.`);
  for (const r of results) {
    const { token: t, verdict: v } = r;
    console.log(`\nLock #${t.tokenId}: ${tokens(t.locked.amount)} AERO${t.locked.isPermanent ? ", permanent" : `, ends ${new Date(Number(t.locked.end) * 1000).toISOString().slice(0, 10)}`}`);
    console.log(v.status === "ready" ? `  READY: would become ${v.outcome.detail}, ${tokens(v.outcome.amount)} AERO.` : `  BLOCKED. Once unblocked it would become ${v.outcome.detail}, ${tokens(v.outcome.amount)} AERO.`);
    for (const b of v.blockers) console.log(`  - blocker: ${b}`);
    for (const tx of r.txs ?? []) console.log(`  tx ${tx.step}: to ${tx.to} data ${tx.data}`);
  }
  if (results.length) {
    console.log("\nBefore you upgrade anything:");
    for (const w of new Set(results.flatMap((r) => r.verdict.warnings))) console.log(`  - ${w}`);
  }
  if (count === 0) console.log("\nNo old veAERO locks in this wallet. If you expected some: they may already be upgraded, sit in a Relay/vault/lending market (their owner is then that contract, not you), or be in another wallet.");
  if (!flag("tx") && results.some((r) => r.verdict.status === "ready")) console.log("\nAdd --tx to print the unsigned approve + depositVeNFT transactions for the ready locks.");
}
