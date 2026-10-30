// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

let n = 0;
const post = (body: string, ip?: string) => {
  n += 1;
  return new Request("http://localhost/api/csp-report", { method: "POST", headers: { "content-type": "application/csp-report", "x-forwarded-for": ip ?? `10.7.0.${n}` }, body });
};

afterEach(() => vi.restoreAllMocks());

describe("POST /api/csp-report", () => {
  it("logs one clipped line per violation and answers 204", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await POST(post(JSON.stringify({ "csp-report": { "effective-directive": "img-src", "blocked-uri": "https://x.example/a.png?token=1", "document-uri": "https://aeroallocator.app/?a=1" } })));
    expect(res.status).toBe(204);
    expect(warn).toHaveBeenCalledTimes(1);
    const line = warn.mock.calls[0].join(" ");
    expect(line).toContain("csp report");
    expect(line).toContain("https://x.example/a.png");
    expect(line).not.toContain("token=1");
    expect(line).not.toContain("a=1");
  });

  it("rejects what is not JSON, and what is too large, without logging", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect((await POST(post("nope"))).status).toBe(400);
    expect((await POST(post("x".repeat(9000)))).status).toBe(413);
    expect(warn).not.toHaveBeenCalled();
  });

  it("logs at most five reports from one batch, and is rate limited per caller", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const one = { type: "csp-violation", body: { effectiveDirective: "img-src", blockedURL: "https://x.example/" } };
    await POST(post(JSON.stringify(Array.from({ length: 9 }, () => one))));
    expect(warn).toHaveBeenCalledTimes(5);
    const ip = "10.9.9.9";
    let last = 0;
    for (let i = 0; i < 25; i++) last = (await POST(post(JSON.stringify(one), ip))).status;
    expect(last).toBe(429);
  });
});
