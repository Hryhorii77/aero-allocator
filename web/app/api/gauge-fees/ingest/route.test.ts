// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/gauge-fees-read", () => ({ updateFeeLedger: vi.fn(async () => ({ lastBlock: 1, coverageFrom: 0, events: [], updatedAt: 0 })) }));
vi.mock("@/lib/daily-history-read", () => ({ recordDailyHistory: vi.fn(async () => 2) }));
vi.mock("@/lib/weight-history-read", () => ({ snapshotWeights: vi.fn(async () => 1) }));
const track = vi.hoisted(() => vi.fn(async () => "logged"));
vi.mock("@/lib/track-record-read", () => ({ recordTrackEntry: track }));

import { GET } from "./route";

let n = 0;
const req = (auth?: string) => {
  n += 1;
  return new Request("http://localhost/api/gauge-fees/ingest?chain=8453", { headers: { "x-forwarded-for": `10.1.0.${n}`, ...(auth ? { authorization: auth } : {}) } });
};

afterEach(() => vi.unstubAllEnvs());

describe("GET /api/gauge-fees/ingest", () => {
  it("is open without CRON_SECRET only outside production (local dev and tests)", async () => {
    expect((await GET(req())).status).toBe(200);
  });

  it("fails closed in production when CRON_SECRET is missing, for every caller", async () => {
    vi.stubEnv("NODE_ENV", "production");
    expect((await GET(req())).status).toBe(401);
    expect((await GET(req("Bearer "))).status).toBe(401);
    expect((await GET(req("Bearer undefined"))).status).toBe(401);
  });

  it("requires the bearer token when CRON_SECRET is set", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret");
    expect((await GET(req())).status).toBe(401);
    expect((await GET(req("Bearer wrong"))).status).toBe(401);
    expect((await GET(req("Bearer s3cret"))).status).toBe(200);
  });

  it("writes down the track-record entry on Base, reports the outcome, and does not touch it on other chains", async () => {
    track.mockClear();
    const base = await GET(req());
    expect(await base.json()).toMatchObject({ chainId: 8453, tracked: "logged" });
    expect(track).toHaveBeenCalledTimes(1);
    const other = await GET(new Request("http://localhost/api/gauge-fees/ingest?chain=10", { headers: { "x-forwarded-for": "10.2.0.1" } }));
    expect((await other.json()).tracked).toBeUndefined();
    expect(track).toHaveBeenCalledTimes(1);
  });

  it("does not fail the fee record when the track-record step throws", async () => {
    track.mockRejectedValueOnce(new Error("blob down"));
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect((await res.json()).tracked).toBeNull();
  });
});
