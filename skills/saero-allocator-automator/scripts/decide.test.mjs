import { describe, expect, it } from "vitest";
import { AERO_VOTER, checkPlan, decide } from "./decide.mjs";

const G1 = "0x00000000000000000000000000000000000000a1";
const G2 = "0x00000000000000000000000000000000000000a2";
const fees = (over = {}) => ({ fees: [{ gauge: G1, feesUsdPerDay: 100, windowHours: 48, steady: { buckets: 6, paying: 6 }, ...over }, { gauge: G2, feesUsdPerDay: 50, windowHours: 48 }] });
const position = (over = {}) => ({
  tokenId: "15308",
  owner: "0x9b3F205E43dc9FcC1cc2Fe6d9dCD0357769A6Bae",
  advice: { action: "switch", reason: "better", canActNow: true, readyAt: null },
  confidence: "solid",
  gainUsdPerDay: 0.2,
  bestSplit: { usdPerDay: 0.5, parts: [{ gauge: G1, symbol: "A/B", pct: 100, usdPerDay: 0.5 }] },
  ...over,
});

describe("decide", () => {
  it("acts when the wait is over, the advice is to switch, confidence is enough and no gauge is a burst", () => {
    const d = decide(position(), { gaugeFees: fees() });
    expect(d.act).toBe(true);
    expect(d.reasons[0]).toMatch(/\$0\.20\/day more/);
    expect(d.flags).toEqual([]);
  });

  it("waits while the position's wait is running, and says until when", () => {
    const d = decide(position({ advice: { action: "switch", reason: "x", canActNow: false, readyAt: "2026-10-28T10:00:00.000Z" } }), { gaugeFees: fees() });
    expect(d).toMatchObject({ act: false, waitUntil: "2026-10-28T10:00:00.000Z" });
  });

  it("does nothing for stay, unknown and none", () => {
    for (const action of ["stay", "unknown", "none"]) {
      expect(decide(position({ advice: { action, reason: `r-${action}`, canActNow: true } }), { gaugeFees: fees() })).toMatchObject({ act: false, reasons: [`r-${action}`] });
    }
  });

  it("allocates idle power when the best split would earn something", () => {
    const d = decide(position({ advice: { action: "allocate", reason: "idle", canActNow: true }, gainUsdPerDay: null }), { gaugeFees: fees() });
    expect(d.act).toBe(true);
    expect(d.reasons[0]).toMatch(/Idle power/);
  });

  it("refuses thin fee history unless the caller lowers the bar", () => {
    expect(decide(position({ confidence: "thin" }), { gaugeFees: fees() }).act).toBe(false);
    expect(decide(position({ confidence: "thin" }), { gaugeFees: fees(), minConfidence: "thin" }).act).toBe(true);
  });

  it("applies a minimum gain", () => {
    expect(decide(position({ gainUsdPerDay: 0.04 }), { gaugeFees: fees(), minGainUsdPerDay: 0.05 }).act).toBe(false);
    expect(decide(position({ gainUsdPerDay: 0.06 }), { gaugeFees: fees(), minGainUsdPerDay: 0.05 }).act).toBe(true);
  });

  it("will not move on a burst, names it, and moves only if told to, with a note", () => {
    const burst = fees({ feesUsdPerDay: 2800, spike: { typicalUsdPerDay: 360 } });
    const d = decide(position(), { gaugeFees: burst });
    expect(d.act).toBe(false);
    expect(d.reasons[0]).toMatch(/burst.*A\/B.*2800.*360/);
    const forced = decide(position(), { gaugeFees: burst, allowSpike: true });
    expect(forced.act).toBe(true);
    expect(forced.flags[0]).toMatch(/burst/);
  });

  it("notes patchy payouts without blocking", () => {
    const d = decide(position(), { gaugeFees: fees({ steady: { buckets: 6, paying: 2 } }) });
    expect(d.act).toBe(true);
    expect(d.flags[0]).toMatch(/patchy payouts \(2 of 6/);
  });

  it("needs the gauge fees, because that is how a burst is told from a steady pace", () => {
    expect(decide(position(), {}).act).toBe(false);
    expect(decide(position(), { gaugeFees: {} }).reasons[0]).toMatch(/gauge-fees/);
  });
});

describe("checkPlan", () => {
  const plan = (over = {}) => ({
    sendFrom: "0x9b3F205E43dc9FcC1cc2Fe6d9dCD0357769A6Bae",
    transaction: { chainId: 8453, to: AERO_VOTER, data: "0x12345678abcdef", value: "0" },
    simulation: { ok: true, gasEstimate: "835802" },
    advice: { action: "switch" },
    ...over,
  });
  const owner = "0x9b3f205e43dc9fcc1cc2fe6d9dcd0357769a6bae";

  it("passes a plan that goes to Aero's Voter on Base from the owner, simulated ok", () => {
    expect(checkPlan(plan(), { owner })).toEqual({ ok: true, problems: [] });
  });

  it("refuses a different target, chain or value, bad data, a failed simulation, another sender, or a stay", () => {
    const cases = [
      plan({ transaction: { chainId: 8453, to: "0x0000000000000000000000000000000000000bad", data: "0x12345678", value: "0" } }),
      plan({ transaction: { chainId: 1, to: AERO_VOTER, data: "0x12345678", value: "0" } }),
      plan({ transaction: { chainId: 8453, to: AERO_VOTER, data: "0x12345678", value: "1" } }),
      plan({ transaction: { chainId: 8453, to: AERO_VOTER, data: "nope", value: "0" } }),
      plan({ simulation: { ok: false, reason: "allocated less than 47 hours ago" } }),
      plan({ sendFrom: "0x0000000000000000000000000000000000000bad" }),
      plan({ advice: { action: "stay" } }),
    ];
    for (const c of cases) expect(checkPlan(c, { owner }).ok).toBe(false);
    expect(checkPlan({}, { owner }).problems).toEqual(["No transaction in the plan."]);
  });
});
