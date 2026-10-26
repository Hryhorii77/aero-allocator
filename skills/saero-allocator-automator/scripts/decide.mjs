// The decision rules of the saero-allocator-automator skill, as plain functions with no dependencies, so an agent can run them
// (`node decide.mjs position.json gauge-fees.json [plan.json]`) or copy the rules. They never sign or send anything.

/** Aero's Voter on Base: the only address an allocate() transaction from this service should be sent to. */
export const AERO_VOTER = "0x49d7d4f17Ec56Ef8fA04E464AF5D1A4942CC31e6";
export const BASE_CHAIN_ID = 8453;

const CONFIDENCE_RANK = { thin: 0, fair: 1, solid: 2 };

/**
 * Whether one position (an item of `positions` from GET /api/v1/position) should be re-allocated now.
 * `gaugeFees` is the body of GET /api/gauge-fees?chain=8453 and is required: it is how a burst of fees is told from a steady pace.
 * Returns { act, reasons, flags, waitUntil? }. `act` is true only when every rule passes.
 */
export function decide(position, opts) {
  const { gaugeFees, minGainUsdPerDay = 0, minConfidence = "fair", allowSpike = false } = opts ?? {};
  if (!position || !position.advice) return { act: false, reasons: ["No position report to decide on."], flags: [] };
  if (!gaugeFees || !Array.isArray(gaugeFees.fees)) return { act: false, reasons: ["Fetch GET /api/gauge-fees?chain=8453 first: it is needed to check for fee spikes."], flags: [] };

  const { advice } = position;
  const flags = [];

  if (advice.action === "none") return { act: false, reasons: [advice.reason], flags };
  // The wait comes first: nothing else matters until the position can be changed again.
  if (!advice.canActNow) return { act: false, reasons: [`Still waiting: the position can be re-allocated at ${advice.readyAt ?? "a later time"}.`], flags, waitUntil: advice.readyAt ?? undefined };
  if (advice.action !== "switch" && advice.action !== "allocate") return { act: false, reasons: [advice.reason], flags };

  if (!(CONFIDENCE_RANK[position.confidence] >= CONFIDENCE_RANK[minConfidence])) {
    return { act: false, reasons: [`The fee history behind the best split is too thin (confidence ${position.confidence ?? "none"}, need ${minConfidence}).`], flags };
  }

  const gain = advice.action === "allocate" ? position.bestSplit?.usdPerDay ?? 0 : position.gainUsdPerDay ?? 0;
  if (!(gain >= minGainUsdPerDay) || !(gain > 0)) return { act: false, reasons: [`The gain (about $${Number(gain).toFixed(2)}/day) is below the minimum ($${minGainUsdPerDay}/day).`], flags };

  const byGauge = new Map(gaugeFees.fees.map((f) => [String(f.gauge).toLowerCase(), f]));
  for (const part of position.bestSplit?.parts ?? []) {
    const fee = byGauge.get(String(part.gauge).toLowerCase());
    if (!fee) {
      flags.push(`${part.symbol}: no fee pace on record.`);
      continue;
    }
    if (fee.spike) {
      const msg = `${part.symbol}: its recent fee pace ($${Math.round(fee.feesUsdPerDay)}/day) is a burst; it usually earns about $${Math.round(fee.spike.typicalUsdPerDay)}/day.`;
      if (!allowSpike) return { act: false, reasons: [`Not moving on a burst. ${msg}`], flags };
      flags.push(msg);
    }
    if (fee.steady && fee.steady.buckets >= 3 && fee.steady.paying / fee.steady.buckets < 0.5) flags.push(`${part.symbol}: patchy payouts (${fee.steady.paying} of ${fee.steady.buckets} half-days paid at least half the average).`);
  }

  return { act: true, reasons: [advice.action === "allocate" ? `Idle power: the best split would earn about $${gain.toFixed(2)}/day.` : `The best split earns about $${gain.toFixed(2)}/day more than where it sits.`], flags };
}

/**
 * Whether an allocate-plan response is safe to hand to the owner's wallet layer. Returns { ok, problems }. It checks what can be
 * checked without a node: where the transaction goes, its chain and value, that the service simulated it as the owner, and that
 * it is from the owner. The wallet layer should still simulate it itself before signing.
 */
export function checkPlan(plan, expected = {}) {
  const problems = [];
  const tx = plan?.transaction;
  if (!tx) return { ok: false, problems: ["No transaction in the plan."] };
  if (String(tx.to).toLowerCase() !== AERO_VOTER.toLowerCase()) problems.push(`The transaction goes to ${tx.to}, not Aero's Voter ${AERO_VOTER}.`);
  if (tx.chainId !== BASE_CHAIN_ID) problems.push(`Chain ${tx.chainId}, expected ${BASE_CHAIN_ID} (Base).`);
  if (tx.value !== "0") problems.push(`It sends value ${tx.value}; an allocation on Base needs none.`);
  if (!/^0x[0-9a-fA-F]{8,}$/.test(String(tx.data))) problems.push("The call data is not hex.");
  if (!plan.simulation || plan.simulation.ok !== true) problems.push(`The simulation as the owner did not pass${plan.simulation?.reason ? `: ${plan.simulation.reason}` : ""}.`);
  if (expected.owner && String(plan.sendFrom).toLowerCase() !== String(expected.owner).toLowerCase()) problems.push(`The plan is to be sent from ${plan.sendFrom}, not the owner ${expected.owner}.`);
  if (plan.advice?.action === "stay") problems.push("The service itself advises staying for this position.");
  return { ok: problems.length === 0, problems };
}

// CLI: node decide.mjs position-report.json gauge-fees.json [plan.json]
if (import.meta.url === `file://${process.argv[1]}`) {
  const { readFileSync } = await import("node:fs");
  const [posFile, feesFile, planFile] = process.argv.slice(2);
  if (!posFile || !feesFile) {
    console.error("usage: node decide.mjs position-report.json gauge-fees.json [plan.json]");
    process.exit(2);
  }
  const report = JSON.parse(readFileSync(posFile, "utf8"));
  const fees = JSON.parse(readFileSync(feesFile, "utf8"));
  const out = (report.positions ?? [report]).map((p) => ({ tokenId: p.tokenId, ...decide(p, { gaugeFees: fees }) }));
  if (planFile) out.push({ plan: checkPlan(JSON.parse(readFileSync(planFile, "utf8")), { owner: (report.positions?.[0] ?? report).owner }) });
  console.log(JSON.stringify(out, null, 2));
}
