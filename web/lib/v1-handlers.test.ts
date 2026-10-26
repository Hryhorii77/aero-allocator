// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { decodeFunctionData, getAddress } from "viem";

const E18 = 10n ** 18n;
const OWNER = getAddress(`0x${"f3".repeat(20)}`);
const addr = (n: number) => getAddress(`0x${n.toString(16).padStart(40, "0")}`);

const mocks = vi.hoisted(() => ({
  readPosition: vi.fn(),
  readOwnerTokenIds: vi.fn(),
  readCurrentGauges: vi.fn(),
  readCooldownSec: vi.fn(async () => 169_200),
  simulateAllocate: vi.fn(),
  getGauges: vi.fn(),
  getGaugeFees: vi.fn(),
}));
vi.mock("./position-server", () => ({
  MAX_OWNER_POSITIONS: 10,
  readPosition: mocks.readPosition,
  readOwnerTokenIds: mocks.readOwnerTokenIds,
  readCurrentGauges: mocks.readCurrentGauges,
  readCooldownSec: mocks.readCooldownSec,
}));
vi.mock("./allocate-sim", () => ({ simulateAllocate: mocks.simulateAllocate }));
vi.mock("./gauges", async (orig) => ({ ...(await orig<typeof import("./gauges")>()), getGauges: mocks.getGauges }));
vi.mock("./gauge-fees-read", () => ({ getGaugeFees: mocks.getGaugeFees }));

import { allocateAbi } from "./allocate";
import { SAERO } from "./saero";
import { openApiSpec } from "./openapi";
import { handleAllocatePlan } from "./v1-allocate-plan";
import { handlePosition } from "./v1-position";

const gaugeRow = (n: number, weight: number) => ({ gauge: addr(n), pool: addr(n + 100), symbol: `P${n}`, weight, sharePct: 1, capPerWeek: 1, activated: true, incentivesUsdPerWeek: 0, incentivesUsdPer1k: 0 });
const position = (over: Record<string, unknown> = {}) => ({
  owner: OWNER, tokenId: 15308n, staked: 10_000, votingPower: 10_000, endSec: 0, isPermanent: true, committed: 10_000, parked: 0,
  parkedRaw: 0n, onBaseRaw: 10_000n * E18, lastAllocatedSec: 0, ...over,
});
const req = (path: string) => new NextRequest(`http://localhost${path}`);

beforeEach(() => {
  for (const m of Object.values(mocks)) if ("mockReset" in m) (m as ReturnType<typeof vi.fn>).mockReset();
  mocks.readCooldownSec.mockResolvedValue(169_200);
  mocks.getGauges.mockResolvedValue({ chainId: 8453, generatedAt: 0, totalWeight: 1, gauges: [gaugeRow(1, 1_000_000), gaugeRow(2, 300_000)] });
  mocks.getGaugeFees.mockResolvedValue({ chainId: 8453, generatedAt: Date.now(), windowHours: 30, aeroUsd: 0.75, fees: [{ gauge: addr(1), feesUsdPerDay: 100, windowHours: 30 }, { gauge: addr(2), feesUsdPerDay: 5000, windowHours: 30 }] });
  mocks.readCurrentGauges.mockResolvedValue([{ gauge: addr(1), symbol: "P1", pct: 100 }]);
  mocks.simulateAllocate.mockResolvedValue({ ok: true, gasEstimate: "835802" });
});

describe("GET /api/v1/position", () => {
  it("answers 400 (never charged) for a missing, doubled or malformed key, and reads nothing", async () => {
    for (const q of ["", "?tokenId=1&address=0x0", "?tokenId=abc", "?tokenId=-1", "?tokenId=1.5", "?address=nope"]) {
      const res = await handlePosition(req(`/api/v1/position${q}`));
      expect(res.status, q).toBe(400);
    }
    expect(mocks.readPosition).not.toHaveBeenCalled();
  });

  it("answers 404 for a position that does not exist and for a wallet with none", async () => {
    mocks.readPosition.mockResolvedValue(null);
    expect((await handlePosition(req("/api/v1/position?tokenId=999999"))).status).toBe(404);
    mocks.readOwnerTokenIds.mockResolvedValue({ owner: OWNER, tokenIds: [], total: 0 });
    expect((await handlePosition(req(`/api/v1/position?address=${OWNER}`))).status).toBe(404);
  });

  it("returns power, cooldown, current and best split, the gain and a switch recommendation", async () => {
    mocks.readPosition.mockResolvedValue(position());
    const res = await handlePosition(req("/api/v1/position?tokenId=15308"));
    expect(res.status).toBe(200);
    const body = await res.json();
    const p = body.positions[0];
    expect(p).toMatchObject({ tokenId: "15308", owner: OWNER, votingPower: 10_000, permanent: true, lockEndsAt: null, idlePower: 0, onBasePower: 10_000 });
    expect(p.cooldown).toEqual({ ready: true, readyAt: null, secondsLeft: 0 });
    expect(p.currentGauges).toEqual([{ gauge: addr(1), symbol: "P1", pct: 100 }]);
    expect(p.bestSplit.parts[0].symbol).toMatch(/P2/);
    expect(p.gainUsdPerDay).toBeGreaterThan(0);
    expect(p.advice).toMatchObject({ action: "switch", canActNow: true });
    expect(p.currentAprPct).toBeGreaterThan(0);
    expect(body.basis).toMatch(/Estimates, not guarantees/);
    expect(body.chainId).toBe(8453);
  });

  it("analyses each position of a wallet and says when it stopped at the first ten", async () => {
    mocks.readOwnerTokenIds.mockResolvedValue({ owner: OWNER, tokenIds: [1n, 2n], total: 14 });
    mocks.readPosition.mockImplementation(async (id: bigint) => position({ tokenId: id }));
    const body = await (await handlePosition(req(`/api/v1/position?address=${OWNER}`))).json();
    expect(body.positions.map((p: { tokenId: string }) => p.tokenId)).toEqual(["1", "2"]);
    expect(body.truncated).toMatchObject({ total: 14, returned: 2 });
  });

  it("shows the wait that is still running", async () => {
    const last = Math.floor(Date.now() / 1000) - 3600;
    mocks.readPosition.mockResolvedValue(position({ lastAllocatedSec: last }));
    const p = (await (await handlePosition(req("/api/v1/position?tokenId=1"))).json()).positions[0];
    expect(p.cooldown.ready).toBe(false);
    expect(p.cooldown.readyAt).toBe(new Date((last + 169_200) * 1000).toISOString());
    expect(p.advice.canActNow).toBe(false);
  });
});

describe("GET /api/v1/allocate-plan", () => {
  it("answers 400 (never charged) for a missing or malformed tokenId or maxGauges", async () => {
    for (const q of ["", "?tokenId=x", "?tokenId=1&maxGauges=0", "?tokenId=1&maxGauges=7", "?tokenId=1&maxGauges=2.5"]) {
      expect((await handleAllocatePlan(req(`/api/v1/allocate-plan${q}`))).status, q).toBe(400);
    }
    expect(mocks.readPosition).not.toHaveBeenCalled();
  });

  it("answers 404 for an unknown position and 422 when no gauge can be ranked", async () => {
    mocks.readPosition.mockResolvedValue(null);
    expect((await handleAllocatePlan(req("/api/v1/allocate-plan?tokenId=1"))).status).toBe(404);
    mocks.readPosition.mockResolvedValue(position());
    mocks.getGaugeFees.mockResolvedValue({ chainId: 8453, generatedAt: 0, windowHours: 0, fees: [] });
    expect((await handleAllocatePlan(req("/api/v1/allocate-plan?tokenId=1"))).status).toBe(422);
  });

  it("returns unsigned allocate() calldata for the best split that the Voter's rules accept", async () => {
    mocks.readPosition.mockResolvedValue(position({ parkedRaw: 2_000n * E18, onBaseRaw: 8_000n * E18 }));
    const res = await handleAllocatePlan(req("/api/v1/allocate-plan?tokenId=15308"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.transaction).toMatchObject({ chainId: 8453, to: SAERO.voter, value: "0" });
    expect(body.sendFrom).toBe(OWNER);
    expect(body.simulation).toEqual({ ok: true, gasEstimate: "835802" });
    expect(body.movesFromIdle).toBe((2_000n * E18).toString());

    const { functionName, args } = decodeFunctionData({ abi: allocateAbi, data: body.transaction.data });
    expect(functionName).toBe("allocate");
    const [tokenId, chains, gaugeDispatches, refund] = args as unknown as [bigint, Array<{ chainId: bigint; delta: bigint; value: bigint }>, Array<{ chainId: bigint; value: bigint; gauges: Array<{ gauge: string; allocated: bigint }> }>, string];
    expect(tokenId).toBe(15308n);
    expect(refund).toBe(OWNER);
    expect(chains).toHaveLength(1);
    expect(chains[0]).toMatchObject({ chainId: 8453n, delta: 2_000n * E18, value: 0n });
    // The contract's rules: one Base entry, amounts add up to the chain total exactly, addresses strictly ascending, no ETH.
    expect(gaugeDispatches).toHaveLength(1);
    const list = gaugeDispatches[0].gauges;
    expect(list.reduce((s, g) => s + g.allocated, 0n)).toBe(10_000n * E18);
    for (let i = 1; i < list.length; i++) expect(BigInt(list[i].gauge) > BigInt(list[i - 1].gauge)).toBe(true);
    expect(gaugeDispatches[0].value).toBe(0n);
    expect(body.picks.map((p: { pct: number }) => p.pct).reduce((a: number, b: number) => a + b, 0)).toBeCloseTo(100, 5);
    expect(body.baseTotal).toBe((10_000n * E18).toString());
  });

  it("passes a failed simulation through with its plain reason, still returning the plan and the wait that explains it", async () => {
    const last = Math.floor(Date.now() / 1000) - 3600;
    mocks.readPosition.mockResolvedValue(position({ lastAllocatedSec: last }));
    mocks.simulateAllocate.mockResolvedValue({ ok: false, reason: "this position was allocated less than 47 hours ago" });
    const body = await (await handleAllocatePlan(req("/api/v1/allocate-plan?tokenId=15308"))).json();
    expect(body.simulation).toEqual({ ok: false, reason: "this position was allocated less than 47 hours ago" });
    expect(body.cooldown.ready).toBe(false);
    expect(body.warnings.join(" ")).toMatch(/Simulation failed: this position was allocated less than 47 hours ago/);
    expect(body.warnings.join(" ")).toMatch(/47-hour wait ends/);
    expect(body.transaction.data).toMatch(/^0x/);
  });

  it("limits the split to maxGauges", async () => {
    mocks.getGauges.mockResolvedValue({ chainId: 8453, generatedAt: 0, totalWeight: 1, gauges: [1, 2, 3, 4].map((n) => gaugeRow(n, 300_000)) });
    mocks.getGaugeFees.mockResolvedValue({ chainId: 8453, generatedAt: 0, windowHours: 30, fees: [1, 2, 3, 4].map((n) => ({ gauge: addr(n), feesUsdPerDay: 4000, windowHours: 30 })) });
    mocks.readPosition.mockResolvedValue(position({ votingPower: 2_000_000, staked: 2_000_000, onBaseRaw: 2_000_000n * E18 }));
    const many = await (await handleAllocatePlan(req("/api/v1/allocate-plan?tokenId=1"))).json();
    const two = await (await handleAllocatePlan(req("/api/v1/allocate-plan?tokenId=1&maxGauges=2"))).json();
    expect(many.picks.length).toBeGreaterThan(2);
    expect(two.picks.length).toBeLessThanOrEqual(2);
  });
});

// The OpenAPI description must name every field the paid routes really return (and only those), so an agent reading it is not surprised.
describe("the OpenAPI schemas match the paid responses", () => {
  const schemas = (openApiSpec("http://localhost") as { components: { schemas: Record<string, { properties?: Record<string, unknown> }> } }).components.schemas;
  type Schema = { $ref?: string; properties?: Record<string, Schema>; items?: Schema; anyOf?: Schema[] };
  const resolve = (s: Schema): Schema => (s.$ref ? (schemas[s.$ref.split("/").pop()!] as Schema) : s);
  /** Keys in `data` that the schema does not list, nested into objects and the first item of arrays. */
  function unlisted(schema: Schema, data: unknown, path = ""): string[] {
    const sc = resolve(schema);
    const out: string[] = [];
    if (Array.isArray(data)) return data.length && sc.items ? unlisted(sc.items, data[0], `${path}[]`) : out;
    if (!data || typeof data !== "object" || !sc.properties) return out;
    for (const [k, v] of Object.entries(data)) {
      const prop = sc.properties[k];
      if (!prop) out.push(`${path}.${k}`);
      else {
        const target = prop.anyOf ? prop.anyOf.find((a) => a.$ref) ?? prop : prop;
        out.push(...unlisted(target, v, `${path}.${k}`));
      }
    }
    return out;
  }

  it("position", async () => {
    mocks.readPosition.mockResolvedValue(position());
    const body = await (await handlePosition(req("/api/v1/position?tokenId=15308"))).json();
    expect(unlisted({ $ref: "#/components/schemas/PositionReport" }, body)).toEqual([]);
  });

  it("allocate-plan", async () => {
    mocks.readPosition.mockResolvedValue(position({ parkedRaw: 2_000n * E18, onBaseRaw: 8_000n * E18 }));
    const body = await (await handleAllocatePlan(req("/api/v1/allocate-plan?tokenId=15308"))).json();
    expect(unlisted({ $ref: "#/components/schemas/AllocatePlan" }, body)).toEqual([]);
  });
});
