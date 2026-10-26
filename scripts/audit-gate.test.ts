import { describe, expect, it } from "vitest";
import { ACCEPTED, advisoriesOf, judge, type AuditReport } from "./audit-gate.js";

const ZOD = Object.keys(ACCEPTED)[0];
const adv = (url: string, name = "zod", severity = "high") => ({ url, name, severity, title: "t" });

describe("audit gate", () => {
  it("reads advisories out of via, ignoring the strings that point at another package, once each", () => {
    const report: AuditReport = {
      vulnerabilities: {
        zod: { via: [adv(ZOD)] },
        wagmi: { via: ["zod", "abitype"] },
        abitype: { via: [adv(ZOD)] },
      },
    };
    expect(advisoriesOf(report).map((a) => a.url)).toEqual([ZOD]);
  });

  it("passes when only the accepted advisory is reported", () => {
    const r = judge({ vulnerabilities: { zod: { via: [adv(ZOD)] }, wagmi: { via: ["zod"] } } });
    expect(r.unexpected).toEqual([]);
    expect(r.gone).toEqual([]);
  });

  it("fails on any other advisory, at any severity", () => {
    const other = "https://github.com/advisories/GHSA-xxxx-xxxx-xxxx";
    for (const severity of ["low", "moderate", "high", "critical"]) {
      const r = judge({ vulnerabilities: { zod: { via: [adv(ZOD)] }, left: { via: [adv(other, "left-pad", severity)] } } });
      expect(r.unexpected.map((a) => a.url)).toEqual([other]);
    }
  });

  it("says when an accepted advisory is no longer reported, and passes on a clean report", () => {
    expect(judge({ vulnerabilities: {} })).toEqual({ unexpected: [], gone: [ZOD] });
    expect(judge({})).toEqual({ unexpected: [], gone: [ZOD] });
  });
});
