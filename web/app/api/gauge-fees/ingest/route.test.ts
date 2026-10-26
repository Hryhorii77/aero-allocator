// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/gauge-fees-read", () => ({ updateFeeLedger: vi.fn(async () => ({ lastBlock: 1, coverageFrom: 0, events: [], updatedAt: 0 })) }));
vi.mock("@/lib/weight-history-read", () => ({ snapshotWeights: vi.fn(async () => 1) }));

import { GET } from "./route";

let n = 0;
const req = (auth?: string) => {
  n += 1;
  return new Request("http://localhost/api/gauge-fees/ingest?chain=8453", { headers: { "x-forwarded-for": `10.1.0.${n}`, ...(auth ? { authorization: auth } : {}) } });
};

afterEach(() => vi.unstubAllEnvs());

describe("GET /api/gauge-fees/ingest", () => {
  it("is open when CRON_SECRET is not set", async () => {
    expect((await GET(req())).status).toBe(200);
  });

  it("requires the bearer token when CRON_SECRET is set", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret");
    expect((await GET(req())).status).toBe(401);
    expect((await GET(req("Bearer wrong"))).status).toBe(401);
    expect((await GET(req("Bearer s3cret"))).status).toBe(200);
  });
});
