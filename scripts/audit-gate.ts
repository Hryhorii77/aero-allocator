/**
 * CI gate for `npm audit --omit=dev`: fails on any advisory that is not on the accepted list below, at any severity, and says so when an
 * accepted one is gone so the entry can be deleted. A plain `npm audit` would fail on every run (the one accepted advisory below is
 * reported through 20+ packages in web/), so it would be ignored; this passes today and fails on anything new.
 *
 *   npx tsx scripts/audit-gate.ts [dir]      dir defaults to the repo root; use `web` for the web app
 *
 * If the audit itself can't run or can't be read, the gate fails (re-run the job): a gate that passes when it can't look is no gate.
 */
import { spawnSync } from "node:child_process";

/** Until when each accepted advisory is tolerated (UTC date). Past it the advisory fails the gate again, so the exception is re-checked, not forgotten. */
export const ACCEPTED_UNTIL: Record<string, string> = {
  "https://github.com/advisories/GHSA-mrhx-c7xc-m3w5": "2026-11-30",
};

/** Advisories accepted for now, by URL, with why. Re-check upstream releases; delete an entry once `npm audit` stops reporting it. */
export const ACCEPTED: Record<string, string> = {
  "https://github.com/advisories/GHSA-mrhx-c7xc-m3w5":
    "zod <4.6.6 can exhaust memory on oversized constrained collections. Pulled in by abitype, wagmi, the x402 packages and the MCP SDK; no release that fixes it is reachable here. Input we validate with zod is small and bounded.",
};

type Via = string | { url?: string; name?: string; severity?: string; title?: string };
export interface AuditReport {
  vulnerabilities?: Record<string, { via?: Via[] }>;
  error?: unknown;
}
export interface Advisory {
  url: string;
  name: string;
  severity: string;
  title: string;
}

/** Every distinct advisory an audit report names (the `via` entries that are objects; strings just point at another package). */
export function advisoriesOf(report: AuditReport): Advisory[] {
  const out = new Map<string, Advisory>();
  for (const v of Object.values(report.vulnerabilities ?? {})) {
    for (const via of v.via ?? []) {
      if (typeof via === "string" || !via.url) continue;
      out.set(via.url, { url: via.url, name: via.name ?? "?", severity: via.severity ?? "?", title: via.title ?? "" });
    }
  }
  return [...out.values()];
}

/** Advisories not on the accepted list, and accepted ones the report no longer shows. */
/** True while an accepted advisory is still inside its date; one with no date never expires (only the repo's own list should omit it). */
function stillAccepted(url: string, nowMs: number, until: Record<string, string>): boolean {
  const d = until[url];
  return d === undefined || nowMs < Date.parse(`${d}T00:00:00Z`) + 86_400_000;
}

export function judge(
  report: AuditReport,
  accepted: Record<string, string> = ACCEPTED,
  nowMs: number = Date.now(),
  until: Record<string, string> = ACCEPTED_UNTIL,
): { unexpected: Advisory[]; gone: string[]; expired: string[] } {
  const found = advisoriesOf(report);
  const seen = new Set(found.map((a) => a.url));
  const ok = (u: string) => u in accepted && stillAccepted(u, nowMs, until);
  return {
    unexpected: found.filter((a) => !ok(a.url)),
    gone: Object.keys(accepted).filter((u) => !seen.has(u)),
    expired: found.filter((a) => a.url in accepted && !ok(a.url)).map((a) => a.url),
  };
}

function main(dir: string): number {
  const run = spawnSync("npm", ["audit", "--omit=dev", "--json"], { cwd: dir, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  let report: AuditReport;
  try {
    report = JSON.parse(run.stdout) as AuditReport;
  } catch {
    console.error(`audit-gate (${dir}): could not read the output of npm audit (exit ${run.status}). ${run.stderr?.slice(0, 300) ?? ""}`);
    return 2;
  }
  if (report.error) {
    console.error(`audit-gate (${dir}): npm audit reported an error: ${JSON.stringify(report.error).slice(0, 300)}`);
    return 2;
  }
  const { unexpected, gone, expired } = judge(report);
  for (const u of expired) console.error(`audit-gate (${dir}): the acceptance of ${u} ran out on ${ACCEPTED_UNTIL[u]}; check whether a fixed release is reachable, then fix it or move the date in ACCEPTED_UNTIL`);
  for (const u of gone) console.log(`audit-gate (${dir}): accepted advisory no longer reported, remove it from ACCEPTED: ${u}`);
  if (unexpected.length > 0) {
    console.error(`audit-gate (${dir}): ${unexpected.length} advisory(ies) not on the accepted list:`);
    for (const a of unexpected) console.error(`  [${a.severity}] ${a.name}: ${a.title} ${a.url}`);
    return 1;
  }
  console.log(`audit-gate (${dir}): ${advisoriesOf(report).length} advisory(ies), all accepted.`);
  return 0;
}

// Run only when started directly (not when the test imports it).
if (process.argv[1] && /audit-gate\.ts$/.test(process.argv[1])) process.exit(main(process.argv[2] ?? "."));
