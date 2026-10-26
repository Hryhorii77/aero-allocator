// One pass of the saero-allocator-automator loop for a wallet or a position: read, decide, and (only if every rule passes) fetch the
// unsigned allocate() transaction and print it for the owner's wallet layer. This script NEVER signs or sends an allocation.
//
//   node run.mjs --address 0x…  |  --token-id 15308   [--dry] [--max-gauges 4] [--min-gain 0.05] [--site https://aeroallocator.app]
//
// The paid calls cost $0.05 (position) and $0.10 (allocate-plan), paid over x402 in USDC on Base from PAYER_PRIVATE_KEY. That key only
// pays for the API calls; keep it separate from the key that owns the sAERO position, and hold only a little USDC on it.
//   npm i @x402/fetch @x402/evm viem      (once, in this folder)
// --dry: makes no payment; shows the free data and the price of each call, and stops.
import { checkPlan, decide } from "./decide.mjs";

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name, fallback) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : fallback);
const site = opt("site", "https://aeroallocator.app");
const address = opt("address");
const tokenId = opt("token-id");
if ((!address && !tokenId) || (address && tokenId)) {
  console.error("Pass exactly one of --address 0x… or --token-id <id>.");
  process.exit(2);
}
const key = address ? `address=${address}` : `tokenId=${tokenId}`;
const minGain = Number(opt("min-gain", "0"));
const maxGauges = opt("max-gauges", "6");
const log = (...a) => console.error(...a);

const getJson = async (fetcher, path) => {
  const res = await fetcher(`${site}${path}`);
  if (!res.ok) throw new Error(`${path} answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
};

const fees = await getJson(fetch, "/api/gauge-fees?chain=8453");
log(`gauge fees: ${fees.fees.length} gauges, ${fees.fees.filter((f) => f.spike).length} flagged as bursts`);

if (flag("dry")) {
  for (const [name, path] of [["position", `/api/v1/position?${key}`], ["allocate-plan", `/api/v1/allocate-plan?${address ? "tokenId=<id>" : key}&maxGauges=${maxGauges}`]]) {
    const res = await fetch(`${site}${path.replace("<id>", "1")}`);
    const header = res.headers.get("payment-required");
    const req = header ? JSON.parse(Buffer.from(header, "base64").toString("utf8")).accepts?.[0] : null;
    log(`${name}: HTTP ${res.status}${req ? `, would pay ${Number(req.amount) / 1e6} USDC to ${req.payTo} on ${req.network}` : ""}`);
  }
  log("--dry: nothing paid, nothing signed.");
  process.exit(0);
}

const pk = process.env.PAYER_PRIVATE_KEY;
if (!pk || !/^0x[0-9a-fA-F]{64}$/.test(pk)) {
  log("Set PAYER_PRIVATE_KEY (a wallet holding a little USDC on Base that only pays for API calls), or use --dry.");
  process.exit(2);
}
const [{ wrapFetchWithPaymentFromConfig }, { ExactEvmScheme }, { privateKeyToAccount }] = await Promise.all([
  import("@x402/fetch"),
  import("@x402/evm"),
  import("viem/accounts"),
]).catch(() => {
  log("Run `npm i @x402/fetch @x402/evm viem` in this folder first.");
  process.exit(2);
});
const paid = wrapFetchWithPaymentFromConfig(fetch, { schemes: [{ network: "eip155:8453", client: new ExactEvmScheme(privateKeyToAccount(pk)) }] });

const report = await getJson(paid, `/api/v1/position?${key}`);
const results = [];
for (const p of report.positions) {
  const d = decide(p, { gaugeFees: fees, minGainUsdPerDay: minGain });
  log(`#${p.tokenId}: ${d.act ? "ACT" : "no action"}. ${d.reasons.join(" ")}${d.flags.length ? ` Notes: ${d.flags.join(" ")}` : ""}`);
  const entry = { tokenId: p.tokenId, decision: d };
  if (d.act) {
    const plan = await getJson(paid, `/api/v1/allocate-plan?tokenId=${p.tokenId}&maxGauges=${maxGauges}`);
    const check = checkPlan(plan, { owner: p.owner });
    log(`#${p.tokenId}: plan ${check.ok ? "passes the checks" : `REFUSED: ${check.problems.join(" ")}`}`);
    entry.plan = check.ok ? { sendFrom: plan.sendFrom, transaction: plan.transaction, picks: plan.picks, expectedUsdPerDay: plan.expectedUsdPerDay, warnings: plan.warnings } : null;
    entry.problems = check.problems;
  }
  results.push(entry);
}
// stdout is the machine-readable result; the unsigned transaction is for the owner's wallet layer to simulate, show and sign.
console.log(JSON.stringify(results, null, 2));
