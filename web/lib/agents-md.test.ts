import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GENERATED_FILES } from "../scripts/generate-agents-md";
import { GET as agentsGet } from "../app/AGENTS.md/route";
import { GET as llmsGet } from "../app/llms.txt/route";
import { AERO_CHAINS } from "./aero-chains";
import { buildAgentsMd, MCP_TOOLS, SITE_ROUTES, SKILLS } from "./agents-md";
import { ALLOCATE_PLAN_PRICE_USD, CROSS_CHAIN_PLAN_PRICE_USD, POSITION_PRICE_USD } from "./paid-prices";
import { AERO_TOKEN, SAERO } from "./saero";

// Tests run from web/ (vitest resolves import.meta.url to a non-file URL under jsdom).
const web = (p: string) => join(process.cwd(), p);
const t = buildAgentsMd("https://aeroallocator.app");

describe("buildAgentsMd", () => {
  it("has a row for every chain the app serves, with its id, name and factory registry", () => {
    for (const c of AERO_CHAINS) expect(t).toContain(`| ${c.name} | ${c.id} | \`${c.registry}\` |`);
    expect(t).toContain(`The app serves ${AERO_CHAINS.length} chains`);
  });
  it("lists the sAERO contracts and the AERO token from saero.ts", () => {
    for (const a of [SAERO.votingEscrow, SAERO.voter, SAERO.leafVoter, AERO_TOKEN]) expect(t).toContain(a);
  });
  it("says Aero is multi-chain, sAERO lives on Base, allocate-plan is Base only, and never lists Unichain", () => {
    expect(t).toMatch(/Aero is multi-chain\. Do not describe Aero, or this app, as Base-only\./);
    expect(t).toMatch(/sAERO positions themselves live on Base \(8453\)/);
    expect(t).toMatch(/`\/api\/v1\/allocate-plan` is Base only/);
    expect(t).not.toMatch(/Unichain/i);
  });
  it("prices the paid routes from the constants the routes charge, and says unconfigured routes answer 501", () => {
    for (const p of [POSITION_PRICE_USD, ALLOCATE_PLAN_PRICE_USD, CROSS_CHAIN_PLAN_PRICE_USD]) expect(t).toContain(`($${p.toFixed(2)})`);
    expect(t).toMatch(/answers these routes with 501/);
  });
  it("states the safety rules", () => {
    expect(t).toMatch(/never holds keys, never signs and never sends/);
    expect(t).toMatch(/a recent pace, not a promise/);
    expect(t).toMatch(/rejected \(400, 404, 422\) is never charged/);
    expect(t).toMatch(/Claiming rewards is not offered/);
  });
  it("describes the MCP server as local stdio, with the package's real tools", () => {
    expect(t).toContain("npx -y aeroallocator-mcp");
    expect(t).toMatch(/not a remote HTTP MCP/);
    const src = readFileSync(web("../packages/mcp/src/tools.mjs"), "utf8");
    expect([...src.matchAll(/name: "([a-z_]+)"/g)].map((m) => m[1])).toEqual([...MCP_TOOLS]);
  });
  it("lists only skills and site routes that exist", () => {
    for (const s of SKILLS) expect(existsSync(web(`../skills/${s.name}/SKILL.md`)), s.name).toBe(true);
    for (const r of SITE_ROUTES) expect(existsSync(web(r.file)), r.file).toBe(true);
  });
  it("carries llms.txt's free and paid endpoints, and keeps the MCP line in its own section", () => {
    for (const path of ["/api/gauges?chain=8453", "/api/top-gauges", "/api/track-record", "/api/v1/position", "/api/v1/cross-chain-plan"]) expect(t).toContain(path);
    expect(t.match(/aeroallocator-mcp/g)?.length).toBe(2);
  });
});

describe("generated copies", () => {
  it("match what the code builds (run npm run generate-agents-md in web/ when this fails)", () => {
    for (const [path, build] of GENERATED_FILES) expect(readFileSync(web(path), "utf8"), path).toBe(build());
  });
});

describe("routes", () => {
  it("serve /AGENTS.md as markdown and /llms.txt as plain text, both fetchable from any origin", async () => {
    const a = agentsGet();
    expect(a.status).toBe(200);
    expect(a.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
    expect(a.headers.get("access-control-allow-origin")).toBe("*");
    expect(await a.text()).toMatch(/^# Aero Allocator/);
    const l = llmsGet();
    expect(l.status).toBe(200);
    expect(l.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(l.headers.get("access-control-allow-origin")).toBe("*");
  });
});
