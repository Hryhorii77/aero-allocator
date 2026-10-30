import { describe, expect, it } from "vitest";
import { readViolation } from "./csp-report";

describe("readViolation", () => {
  it("reads the legacy report-uri format and drops query strings", () => {
    const v = readViolation({
      "csp-report": {
        "document-uri": "https://aeroallocator.app/?address=0xabc&amount=1",
        "violated-directive": "connect-src",
        "effective-directive": "connect-src",
        "blocked-uri": "https://rpc.example.com/v1/secretkey?x=1",
        disposition: "report",
        "source-file": "https://aeroallocator.app/_next/static/a.js",
      },
    });
    expect(v).toEqual({
      directive: "connect-src",
      blocked: "https://rpc.example.com/v1/secretkey",
      page: "https://aeroallocator.app/",
      source: "https://aeroallocator.app/_next/static/a.js",
      disposition: "report",
    });
  });

  it("reads the Reporting API format", () => {
    const v = readViolation({ type: "csp-violation", body: { documentURL: "https://aeroallocator.app/", effectiveDirective: "script-src-elem", blockedURL: "inline", disposition: "report" } });
    expect(v).toMatchObject({ directive: "script-src-elem", blocked: "inline", page: "https://aeroallocator.app/" });
  });

  it("clips long values, keeps keywords, and ignores anything that isn't a violation", () => {
    expect(readViolation({ "csp-report": { "effective-directive": "x".repeat(500), "blocked-uri": "eval" } })?.directive).toHaveLength(60);
    expect(readViolation({ "csp-report": { "blocked-uri": "eval" } })?.blocked).toBe("eval");
    expect(readViolation(null)).toBeNull();
    expect(readViolation("text")).toBeNull();
    expect(readViolation({ hello: "world" })).toBeNull();
    expect(readViolation({ "csp-report": { disposition: "report" } })).toBeNull();
  });
});
