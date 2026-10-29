import { describe, expect, it } from "vitest";
import { ACCEPTED, ACCEPTED_UNTIL, advisoriesOf, judge, type AuditReport } from "./audit-gate.js";

const ZOD = Object.keys(ACCEPTED)[0];
const NOW = Date.UTC(2026, 9, 30); // inside the acceptance window, so these tests don't start failing on their own
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
    const r = judge({ vulnerabilities: { zod: { via: [adv(ZOD)] }, wagmi: { via: ["zod"] } } }, ACCEPTED, NOW);
    expect(r.unexpected).toEqual([]);
    expect(r.gone).toEqual([]);
  });

  it("fails on any other advisory, at any severity", () => {
    const other = "https://github.com/advisories/GHSA-xxxx-xxxx-xxxx";
    for (const severity of ["low", "moderate", "high", "critical"]) {
      const r = judge({ vulnerabilities: { zod: { via: [adv(ZOD)] }, left: { via: [adv(other, "left-pad", severity)] } } }, ACCEPTED, NOW);
      expect(r.unexpected.map((a) => a.url)).toEqual([other]);
    }
  });

  it("says when an accepted advisory is no longer reported, and passes on a clean report", () => {
    expect(judge({ vulnerabilities: {} }, ACCEPTED, NOW)).toEqual({ unexpected: [], gone: [ZOD], expired: [] });
    expect(judge({}, ACCEPTED, NOW)).toEqual({ unexpected: [], gone: [ZOD], expired: [] });
  });

  it("gives every accepted advisory an expiry date", () => {
    for (const u of Object.keys(ACCEPTED)) expect(ACCEPTED_UNTIL[u], u).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("fails an accepted advisory again once its date has passed, and says it expired", () => {
    const report: AuditReport = { vulnerabilities: { zod: { via: [adv(ZOD)] } } };
    const last = Date.parse(`${ACCEPTED_UNTIL[ZOD]}T12:00:00Z`);
    expect(judge(report, ACCEPTED, last).unexpected).toEqual([]);
    const after = judge(report, ACCEPTED, last + 86_400_000);
    expect(after.unexpected.map((a) => a.url)).toEqual([ZOD]);
    expect(after.expired).toEqual([ZOD]);
  });
});
