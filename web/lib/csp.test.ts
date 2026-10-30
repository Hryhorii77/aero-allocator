import { describe, expect, it } from "vitest";
import { AERO_CHAINS } from "./aero-chains";
import { cspDirectives, cspReportOnly, CSP_REPORT_PATH, RPC_ORIGINS } from "./csp";
import { DISPLAY_PRESET } from "./protocol";

const origin = (u: string) => new URL(u).origin;

describe("content security policy (report-only)", () => {
  it("covers every node the browser reads from, so adding a chain can't silently trip the policy", () => {
    const urls = [DISPLAY_PRESET.defaultRpcUrl, DISPLAY_PRESET.fallbackRpcUrl, ...AERO_CHAINS.flatMap((c) => [...c.rpcs, ...(c.logRpcs ?? [])])];
    const allowed = new Set(cspDirectives()["connect-src"]);
    for (const u of urls) expect(allowed.has(origin(u)), u).toBe(true);
    expect(RPC_ORIGINS.every((o) => o === origin(o))).toBe(true);
  });

  it("closes what the page never needs and reports to our endpoint", () => {
    const d = cspDirectives();
    expect(d["object-src"]).toEqual(["'none'"]);
    expect(d["frame-ancestors"]).toEqual(["'none'"]);
    expect(d["base-uri"]).toEqual(["'self'"]);
    expect(d["form-action"]).toEqual(["'self'"]);
    expect(d["report-uri"]).toEqual([CSP_REPORT_PATH]);
  });

  it("allows only our own origin and the wallet SDKs' hosts to be connected to, not any https site", () => {
    const connect = cspDirectives()["connect-src"];
    expect(connect).not.toContain("https:");
    expect(connect).not.toContain("*");
    expect(connect.some((s) => s.includes("walletconnect"))).toBe(true);
  });

  it("lets WalletConnect's window load its font, which the first run of the policy reported", () => {
    expect(cspDirectives()["font-src"]).toContain("https://fonts.reown.com");
  });

  it("serializes to a single header value with each directive once", () => {
    const v = cspReportOnly();
    const names = v.split("; ").map((x) => x.split(" ")[0]);
    expect(new Set(names).size).toBe(names.length);
    expect(v).toContain("default-src 'self'");
  });
});
