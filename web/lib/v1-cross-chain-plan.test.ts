// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { decodeFunctionData, getAddress } from "viem";

const E18 = 10n ** 18n;
const OWNER = getAddress(`0x${"f3".repeat(20)}`);
const addr = (n: number) => getAddress(`0x${n.toString(16).padStart(40, "0")}`);

const mocks = vi.hoisted(() => ({
  readPosition: vi.fn(),
  readOtherChainAmounts: vi.fn(),
  readCurrentGauges: vi.fn(),
  readCooldownSec: vi.fn(async () => 169_200),
  simulateStep: vi.fn(),
  readAllChainsSplit: vi.fn(),
  getGauges: vi.fn(),
  getGaugeFees: vi.fn(),
  readLeafChain: vi.fn(),
  quoteCostModel: vi.fn(),
}));
vi.mock("./position-server", () => ({ readPosition: mocks.readPosition, readOtherChainAmounts: mocks.readOtherChainAmounts, readCurrentGauges: mocks.readCurrentGauges, readCooldownSec: mocks.readCooldownSec }));
vi.mock("./allocate-sim", () => ({ simulateStep: mocks.simulateStep }));
vi.mock("./all-chains-read", () => ({ readAllChainsSplit: mocks.readAllChainsSplit }));
vi.mock("./gauges", async (orig) => ({ ...(await orig<typeof import("./gauges")>()), getGauges: mocks.getGauges }));
vi.mock("./gauge-fees-read", () => ({ getGaugeFees: mocks.getGaugeFees }));
vi.mock("./leaf-read", () => ({ readLeafChain: mocks.readLeafChain }));
vi.mock("./allocate-fee", async (orig) => ({ ...(await orig<typeof import("./allocate-fee")>()), quoteCostModel: mocks.quoteCostModel }));

import { allocateAbi, DEALLOC_GAUGE } from "./allocate";
import { openApiSpec } from "./openapi";
import { SAERO } from "./saero";
import { handleCrossChainPlan, parseChainsParam } from "./v1-cross-chain-plan";

const req = (qs: string) => new NextRequest(`http://localhost/api/v1/cross-chain-plan${qs}`);
const position = (over: Record<string, unknown> = {}) => ({ owner: OWNER, tokenId: 15308n, staked: 1000, votingPower: 1000, endSec: 0, isPermanent: true, committed: 1000, parked: 1000, parkedRaw: 1000n * E18, onBaseRaw: 0n, lastAllocatedSec: 0, ...over });
const gaugeRow = (a: ReturnType<typeof addr>, symbol: string) => ({ gauge: a, pool: addr(0xc0), symbol, weight: 2_000_000, sharePct: 1, capPerWeek: 1, activated: true, incentivesUsdPerWeek: 0, incentivesUsdPer1k: 0 });
const bestSplit = (chains: unknown[]) => ({ amount: 1000, days: 1.96, ethUsd: 2300, generatedAt: Date.now(), skipped: [], baseOnly: null, best: { chains, usdPerDay: 20, feeUsd: 0.5, netUsd: 38, weakestHours: 30, spiky: false, confidence: "solid" } });
const part = (gauge: string, symbol: string, pct: number) => ({ gauge, symbol, pct, usdPerDay: 1 });
const spread = bestSplit([
  { chainId: 8453, name: "Base", pct: 60, usdPerDay: 12, feeUsd: 0, parts: [part(addr(5), "A/B", 60)] },
  { chainId: 10, name: "OP", pct: 40, usdPerDay: 8, feeUsd: 0.5, parts: [part(addr(9), "C/D", 40)] },
]);
const leafState = (o: Record<string, unknown> = {}) => ({ chainId: 10, gauges: [], total: 0n, idle: 0n, lastAllocatedSec: 0, cooldownSec: 169_200, ...o });

beforeEach(() => {
  for (const m of Object.values(mocks)) if ("mockReset" in m) (m as ReturnType<typeof vi.fn>).mockReset();
  mocks.readCooldownSec.mockResolvedValue(169_200);
  mocks.readPosition.mockResolvedValue(position());
  mocks.readOtherChainAmounts.mockResolvedValue({ 1: 0n, 10: 0n, 42161: 0n, 57073: 0n, 4663: 0n, 5042: 0n });
  mocks.readCurrentGauges.mockResolvedValue([]);
  mocks.simulateStep.mockResolvedValue({ ok: true, gasEstimate: "1000000" });
  mocks.readAllChainsSplit.mockResolvedValue(spread);
  mocks.quoteCostModel.mockImplementation(async (chainId: number) => ({ chainId, chainStepWei: 1000n, gaugeBaseWei: 1000n, perGaugeWei: 1000n, returnCostWei: 145n }));
  mocks.readLeafChain.mockImplementation(async (chainId: number) => leafState({ chainId }));
  mocks.getGauges.mockImplementation(async (chainId: number) => ({ chainId, generatedAt: 0, totalWeight: 1, gauges: [gaugeRow(chainId === 10 ? addr(9) : addr(5), chainId === 10 ? "C/D" : "A/B")] }));
  mocks.getGaugeFees.mockImplementation(async (chainId: number) => ({ chainId, generatedAt: Date.now(), windowHours: 30, aeroUsd: 0.75, fees: [{ gauge: chainId === 10 ? addr(9) : addr(5), feesUsdPerDay: 500, windowHours: 30 }] }));
});

describe("parseChainsParam", () => {
  it("reads chainId:percent pairs for the chains other than Base", () => {
    expect(parseChainsParam("5042:30,10:20.5")).toEqual({ shares: [{ chainId: 5042, name: "Arc", hundredths: 3000 }, { chainId: 10, name: "OP", hundredths: 2050 }] });
  });
  it("refuses Base, unknown or repeated chains, bad percentages and more than 100%", () => {
    for (const bad of ["", "8453:10", "999:10", "10:10,10:20", "10:0", "10:abc", "10:101", "10", "10:60,5042:50", ":30", "10:30,"]) expect("error" in parseChainsParam(bad), bad).toBe(true);
  });
});

describe("GET /api/v1/cross-chain-plan", () => {
  it("answers 400 (never charged) for a missing or malformed tokenId, chains or days, and reads nothing", async () => {
    for (const qs of ["", "?tokenId=abc", "?tokenId=-1", "?tokenId=1&chains=8453:10", "?tokenId=1&chains=10:abc", "?tokenId=1&chains=", "?tokenId=1&days=0", "?tokenId=1&days=91", "?tokenId=1&days=x"]) {
      expect((await handleCrossChainPlan(req(qs))).status, qs).toBe(400);
    }
    expect(mocks.readPosition).not.toHaveBeenCalled();
  });

  it("answers 404 for an unknown position and 422 for one with no power", async () => {
    mocks.readPosition.mockResolvedValue(null);
    expect((await handleCrossChainPlan(req("?tokenId=999999"))).status).toBe(404);
    mocks.readPosition.mockResolvedValue(position({ parkedRaw: 0n, onBaseRaw: 0n }));
    expect((await handleCrossChainPlan(req("?tokenId=15308"))).status).toBe(422);
  });

  it("returns the best split over all chains as one unsigned, simulated step with the ETH to attach", async () => {
    const res = await handleCrossChainPlan(req("?tokenId=15308"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ mode: "best", sendFrom: OWNER, tokenId: "15308", baseWaitHours: 47 });
    expect(body.targets.map((t: { name: string; pct: number }) => [t.name, t.pct])).toEqual([["Base", 60], ["OP", 40]]);
    expect(body.steps).toHaveLength(1);
    const step = body.steps[0];
    expect(step).toMatchObject({ index: 1, kind: "send", canSendNow: true, blockedBy: [], chains: [10, 8453], simulation: { ok: true }, suggestedGasLimit: "1300000" });
    expect(step.transaction).toMatchObject({ chainId: 8453, to: SAERO.voter });
    // (chain step 1000 + gauge step 1000 + 1000 x 1 gauge) with the 10% margin
    expect(step.transaction.value).toBe("3300");
    const decoded = decodeFunctionData({ abi: allocateAbi, data: step.transaction.data });
    expect((decoded.args as unknown as [bigint, Array<{ chainId: bigint; delta: bigint }>])[1].map((c) => [c.chainId, c.delta])).toEqual([[10n, 400n * E18], [8453n, 600n * E18]]);
    expect(mocks.simulateStep).toHaveBeenCalledTimes(1);
  });

  it("plans the caller's percentages, with Base keeping the rest and the best gauges inside each share", async () => {
    const body = await (await handleCrossChainPlan(req("?tokenId=15308&chains=10:30"))).json();
    expect(body.mode).toBe("chains");
    expect(body.targets.map((t: { name: string; pct: number }) => [t.name, t.pct])).toEqual([["Base", 70], ["OP", 30]]);
    expect(mocks.readAllChainsSplit).not.toHaveBeenCalled();
  });

  it("is a return then a send when a chain's share goes down, the second blocked until the idle power is back", async () => {
    mocks.readPosition.mockResolvedValue(position({ parkedRaw: 0n, onBaseRaw: 1000n * E18 }));
    const body = await (await handleCrossChainPlan(req("?tokenId=15308&chains=10:30"))).json();
    expect(body.steps.map((s: { kind: string }) => s.kind)).toEqual(["return", "send"]);
    expect(body.steps[0]).toMatchObject({ canSendNow: true, simulation: { ok: true } });
    expect(body.steps[1].simulation).toBeNull();
    expect(body.steps[1].canSendNow).toBe(false);
    expect(body.steps[1].blockedBy.join(" ")).toMatch(/idle power/);
    // Base returns instantly, so no message is involved
    expect(body.steps[1].blockedBy.join(" ")).toMatch(/Base is instant/);
    const dec = decodeFunctionData({ abi: allocateAbi, data: body.steps[0].transaction.data }).args as unknown as [bigint, unknown[], Array<{ gauges: Array<{ gauge: string; allocated: bigint }> }>];
    expect(dec[2][0].gauges.find((g) => g.gauge === DEALLOC_GAUGE)?.allocated).toBe(300n * E18);
  });

  it("returns power from another chain with that chain's return fee, and says the step waits for the chain's own wait", async () => {
    mocks.readPosition.mockResolvedValue(position({ parkedRaw: 0n, onBaseRaw: 0n }));
    mocks.readOtherChainAmounts.mockResolvedValue({ 1: 0n, 10: 1000n * E18, 42161: 0n, 57073: 0n, 4663: 0n, 5042: 0n });
    mocks.readLeafChain.mockImplementation(async (chainId: number) => leafState({ chainId, gauges: chainId === 10 ? [{ gauge: addr(9), amount: 1000n * E18 }] : [], total: chainId === 10 ? 1000n * E18 : 0n, lastAllocatedSec: chainId === 10 ? Math.floor(Date.now() / 1000) - 60 : 0 }));
    const body = await (await handleCrossChainPlan(req("?tokenId=15308&chains=5042:100"))).json();
    // all of the position is on OP and goes to Arc: return from OP first
    const first = body.steps[0];
    expect(first).toMatchObject({ kind: "return", chains: [10], canSendNow: false });
    expect(first.blockedBy.join(" ")).toMatch(/OP is in its wait/);
    // the send waits for the return message from OP
    expect(body.steps[1].blockedBy.join(" ")).toMatch(/return message/);
    // outbound fee for one entry (1000 + 1000) with the margin, plus OP's exact return cost
    expect(first.transaction.value).toBe(String(2200 + 145));
  });

  it("says a change is still on its way when a chain and Base disagree about the amount", async () => {
    mocks.readPosition.mockResolvedValue(position({ parkedRaw: 0n, onBaseRaw: 0n }));
    mocks.readOtherChainAmounts.mockResolvedValue({ 1: 0n, 10: 1000n * E18, 42161: 0n, 57073: 0n, 4663: 0n, 5042: 0n });
    mocks.readLeafChain.mockImplementation(async (chainId: number) => leafState({ chainId, gauges: chainId === 10 ? [{ gauge: addr(9), amount: 500n * E18 }] : [], total: chainId === 10 ? 500n * E18 : 0n }));
    const body = await (await handleCrossChainPlan(req("?tokenId=15308&chains=5042:100"))).json();
    expect(body.steps[0].blockedBy.join(" ")).toMatch(/still on its way/);
  });

  it("blocks a step that touches Base during Base's own wait", async () => {
    mocks.readPosition.mockResolvedValue(position({ lastAllocatedSec: Math.floor(Date.now() / 1000) - 3600 }));
    const body = await (await handleCrossChainPlan(req("?tokenId=15308"))).json();
    expect(body.steps[0].canSendNow).toBe(false);
    expect(body.steps[0].blockedBy.join(" ")).toMatch(/Base is in its 47-hour wait/);
  });

  it("passes a failed simulation through with its plain reason, still returning the plan", async () => {
    mocks.simulateStep.mockResolvedValue({ ok: false, reason: "this position was allocated too recently" });
    const body = await (await handleCrossChainPlan(req("?tokenId=15308"))).json();
    expect(body.steps[0].simulation).toEqual({ ok: false, reason: "this position was allocated too recently" });
    expect(body.warnings.join(" ")).toMatch(/Simulation of step 1 failed/);
    expect(body.steps[0].suggestedGasLimit).toBeNull();
  });

  it("answers 422 when the position already matches the split, and 503 when a chain's cost can't be read", async () => {
    mocks.readPosition.mockResolvedValue(position({ parkedRaw: 0n, onBaseRaw: 1000n * E18 }));
    mocks.readCurrentGauges.mockResolvedValue([{ gauge: addr(5), symbol: "A/B", pct: 100 }]);
    mocks.readAllChainsSplit.mockResolvedValue(bestSplit([{ chainId: 8453, name: "Base", pct: 100, usdPerDay: 20, feeUsd: 0, parts: [part(addr(5), "A/B", 100)] }]));
    const same = await handleCrossChainPlan(req("?tokenId=15308"));
    expect(same.status).toBe(422);
    expect((await same.json()).error).toMatch(/already matches/);
    mocks.readPosition.mockResolvedValue(position());
    mocks.readAllChainsSplit.mockResolvedValue(spread);
    mocks.quoteCostModel.mockRejectedValue(new Error("rpc down"));
    expect((await handleCrossChainPlan(req("?tokenId=15308"))).status).toBe(503);
  });
});

// The OpenAPI description must name every field the paid route really returns (and only those).
describe("the OpenAPI schema matches the cross-chain plan response", () => {
  const schemas = (openApiSpec("http://localhost") as { components: { schemas: Record<string, { properties?: Record<string, unknown> }> } }).components.schemas;
  type Schema = { $ref?: string; properties?: Record<string, Schema>; items?: Schema; anyOf?: Schema[]; additionalProperties?: unknown };
  const resolve = (s: Schema): Schema => (s.$ref ? (schemas[s.$ref.split("/").pop()!] as Schema) : s);
  function unlisted(schema: Schema, data: unknown, path = ""): string[] {
    const sc = resolve(schema);
    const out: string[] = [];
    if (Array.isArray(data)) return data.length && sc.items ? unlisted(sc.items, data[0], `${path}[]`) : out;
    if (!data || typeof data !== "object" || !sc.properties) return out;
    for (const [k, v] of Object.entries(data)) {
      const prop = sc.properties[k];
      if (!prop) out.push(`${path}.${k}`);
      else out.push(...unlisted(prop.anyOf ? (prop.anyOf.find((a) => a.$ref) ?? prop) : prop, v, `${path}.${k}`));
    }
    return out;
  }
  it("lists every field, including those of a plan with two steps", async () => {
    mocks.readPosition.mockResolvedValue(position({ parkedRaw: 0n, onBaseRaw: 1000n * E18 }));
    const body = await (await handleCrossChainPlan(req("?tokenId=15308&chains=10:30"))).json();
    expect(body.steps).toHaveLength(2);
    expect(unlisted({ $ref: "#/components/schemas/CrossChainPlan" }, body)).toEqual([]);
  });
});
